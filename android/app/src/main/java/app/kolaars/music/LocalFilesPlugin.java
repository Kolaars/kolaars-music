package app.kolaars.music;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.database.Cursor;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * Storage Access Framework bridge.
 *
 * Android gives an app no filesystem paths: the user hands out opaque
 * `content://` URIs, and only the document provider can read them. This plugin
 * is the thin native half — it opens the system pickers, copies the chosen
 * documents into the app's own `files/music` directory (where Capacitor can
 * stream them to the WebView), and reads or writes the few text documents the
 * app needs (track lists, exported playlists, `.lrc` files).
 *
 * Tag parsing, duplicate detection and lyrics stay in TypeScript.
 */
@CapacitorPlugin(name = "LocalFiles")
public class LocalFilesPlugin extends Plugin {

    /** Copies never grow beyond this; a stray ISO image must not fill the phone. */
    private static final long MAX_COPY_BYTES = 1024L * 1024L * 1024L;
    private static final long MAX_TEXT_BYTES = 4L * 1024L * 1024L;
    private static final int MAX_TREE_DEPTH = 8;

    /* ------------------------------------------------------------------ */
    /* Pickers                                                             */
    /* ------------------------------------------------------------------ */

    @PluginMethod
    public void pickFiles(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "*/*"));
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickFilesResult");
    }

    @ActivityCallback
    private void pickFilesResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        JSObject ret = new JSObject();
        JSArray uris = new JSArray();
        Intent data = result.getData();

        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            Uri single = data.getData();
            if (single != null) {
                keepPermission(single);
                uris.put(single.toString());
            }
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i += 1) {
                    Uri uri = clip.getItemAt(i).getUri();
                    if (uri == null) {
                        continue;
                    }
                    keepPermission(uri);
                    uris.put(uri.toString());
                }
            }
        }

        ret.put("uris", uris);
        call.resolve(ret);
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickFolderResult");
    }

    @ActivityCallback
    private void pickFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null && data.getData() != null) {
            Uri tree = data.getData();
            keepPermission(tree);
            ret.put("uri", tree.toString());
            ret.put("name", displayName(tree));
        } else {
            ret.put("uri", null);
        }
        call.resolve(ret);
    }

    /** A track list from another service: one plain-text document. */
    @PluginMethod
    public void pickTextFile(final PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "text/*"));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "pickTextFileResult");
    }

    @ActivityCallback
    private void pickTextFileResult(final PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject().put("path", null));
            return;
        }
        final Uri uri = data.getData();
        keepPermission(uri);
        background(() -> {
            try {
                String text = readText(uri, MAX_TEXT_BYTES);
                JSObject ret = new JSObject();
                ret.put("path", uri.toString());
                ret.put("name", displayName(uri));
                ret.put("text", text);
                call.resolve(ret);
            } catch (Exception error) {
                call.reject("Не удалось прочитать файл: " + error.getMessage(), error);
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /* Documents                                                           */
    /* ------------------------------------------------------------------ */

    /**
     * Recursively lists a tree handed out by `pickFolder`.
     * Returns audio files, `.lrc` sidecars and cover images in one pass so the
     * importer can pair them by file name.
     */
    @PluginMethod
    public void listTree(final PluginCall call) {
        final String raw = call.getString("uri");
        if (raw == null || raw.isEmpty()) {
            call.reject("Нужен URI папки");
            return;
        }
        final Uri tree = Uri.parse(raw);
        background(() -> {
            try {
                JSArray entries = new JSArray();
                Deque<Object[]> queue = new ArrayDeque<>();
                queue.add(new Object[] { DocumentsContract.getTreeDocumentId(tree), 0 });
                ContentResolver resolver = getContext().getContentResolver();

                while (!queue.isEmpty()) {
                    Object[] item = queue.poll();
                    String parentId = (String) item[0];
                    int depth = (Integer) item[1];
                    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);

                    try (Cursor cursor = resolver.query(
                        children,
                        new String[] {
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                            DocumentsContract.Document.COLUMN_MIME_TYPE,
                            DocumentsContract.Document.COLUMN_SIZE
                        },
                        null,
                        null,
                        null
                    )) {
                        if (cursor == null) {
                            continue;
                        }
                        while (cursor.moveToNext()) {
                            String docId = cursor.getString(0);
                            String name = cursor.getString(1);
                            String mime = cursor.getString(2);
                            boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
                            if (name != null && name.startsWith(".")) {
                                continue;
                            }
                            if (isDir) {
                                if (depth < MAX_TREE_DEPTH) {
                                    queue.add(new Object[] { docId, depth + 1 });
                                }
                                continue;
                            }
                            JSObject entry = new JSObject();
                            entry.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, docId).toString());
                            entry.put("name", name);
                            entry.put("mime", mime);
                            entry.put("size", cursor.isNull(3) ? -1 : cursor.getLong(3));
                            entries.put(entry);
                        }
                    }
                }

                JSObject ret = new JSObject();
                ret.put("entries", entries);
                call.resolve(ret);
            } catch (Exception error) {
                call.reject("Не удалось прочитать папку: " + error.getMessage(), error);
            }
        });
    }

    /** Deletes a file the importer copied. Refuses anything outside app storage. */
    @PluginMethod
    public void deleteFile(final PluginCall call) {
        final String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("Нужен путь к файлу");
            return;
        }
        background(() -> {
            try {
                File target = new File(path).getCanonicalFile();
                String root = getContext().getFilesDir().getCanonicalPath() + File.separator;
                if (!target.getPath().startsWith(root)) {
                    call.reject("Файл вне папки приложения");
                    return;
                }
                boolean removed = target.delete();
                call.resolve(new JSObject().put("removed", removed));
            } catch (Exception error) {
                call.reject("Не удалось удалить файл: " + error.getMessage(), error);
            }
        });
    }

    /** Names and sizes of picked documents, before anything is copied. */
    @PluginMethod
    public void describe(final PluginCall call) {
        final JSArray input = call.getArray("uris");
        final List<String> uris = new ArrayList<>();
        if (input != null) {
            for (int i = 0; i < input.length(); i += 1) {
                String raw = input.optString(i, null);
                if (raw != null && !raw.isEmpty()) {
                    uris.add(raw);
                }
            }
        }

        background(() -> {
            JSArray documents = new JSArray();
            for (String raw : uris) {
                Uri uri = Uri.parse(raw);
                JSObject document = new JSObject();
                document.put("uri", raw);
                document.put("name", displayName(uri));
                document.put("size", documentSize(uri));
                String mime = null;
                try {
                    mime = getContext().getContentResolver().getType(uri);
                } catch (Exception ignored) {
                    // Unknown type is fine: the extension decides.
                }
                document.put("mime", mime);
                documents.put(document);
            }
            JSObject ret = new JSObject();
            ret.put("documents", documents);
            call.resolve(ret);
        });
    }

    /** Copies one picked document into `files/<folder>` and returns its path. */
    @PluginMethod
    public void copyToMusic(final PluginCall call) {
        final String raw = call.getString("uri");
        final String preferred = call.getString("name");
        final String folder = safeName(call.getString("folder", "music"));
        if (raw == null || raw.isEmpty()) {
            call.reject("Нужен URI файла");
            return;
        }
        final Uri uri = Uri.parse(raw);
        background(() -> {
            try {
                File dir = new File(getContext().getFilesDir(), folder);
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("Не удалось создать папку для музыки");
                    return;
                }

                String name = safeName(preferred != null ? preferred : displayName(uri));
                File target = uniqueTarget(dir, name, uri);

                try (
                    InputStream input = getContext().getContentResolver().openInputStream(uri);
                    OutputStream output = new FileOutputStream(target)
                ) {
                    if (input == null) {
                        throw new IllegalStateException("провайдер не отдал файл");
                    }
                    byte[] buffer = new byte[64 * 1024];
                    long total = 0;
                    int read;
                    while ((read = input.read(buffer)) > 0) {
                        total += read;
                        if (total > MAX_COPY_BYTES) {
                            throw new IllegalStateException("файл больше 1 ГБ");
                        }
                        output.write(buffer, 0, read);
                    }
                } catch (Exception error) {
                    // A half-written copy is worse than none: the library would
                    // index a broken track.
                    //noinspection ResultOfMethodCallIgnored
                    target.delete();
                    throw error;
                }

                JSObject ret = new JSObject();
                ret.put("path", target.getAbsolutePath());
                ret.put("name", target.getName());
                ret.put("size", target.length());
                call.resolve(ret);
            } catch (Exception error) {
                call.reject("Не удалось скопировать файл: " + error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void readText(final PluginCall call) {
        final String raw = call.getString("uri");
        if (raw == null || raw.isEmpty()) {
            call.reject("Нужен URI файла");
            return;
        }
        final Uri uri = Uri.parse(raw);
        background(() -> {
            try {
                call.resolve(new JSObject().put("text", readText(uri, MAX_TEXT_BYTES)));
            } catch (Exception error) {
                call.reject("Не удалось прочитать файл: " + error.getMessage(), error);
            }
        });
    }

    /** Asks the user where to put a text document and writes it there. */
    @PluginMethod
    public void writeText(final PluginCall call) {
        String fileName = safeName(call.getString("fileName", "kolaars.txt"));
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "text/plain"));
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "writeTextResult");
    }

    @ActivityCallback
    private void writeTextResult(final PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject().put("uri", null));
            return;
        }
        final Uri uri = data.getData();
        final String text = call.getString("text", "");
        background(() -> {
            try (
                OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")
            ) {
                if (output == null) {
                    throw new IllegalStateException("провайдер не открыл файл на запись");
                }
                output.write(text.getBytes(StandardCharsets.UTF_8));
                output.flush();
            } catch (Exception error) {
                call.reject("Не удалось сохранить файл: " + error.getMessage(), error);
                return;
            }
            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            ret.put("name", displayName(uri));
            call.resolve(ret);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    private void background(Runnable task) {
        new Thread(task, "kolaars-local-files").start();
    }

    private void keepPermission(Uri uri) {
        try {
            getContext()
                .getContentResolver()
                .takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
            // Single-document reads stay valid for the lifetime of the grant,
            // which is all an import needs.
        }
    }

    private String readText(Uri uri, long limit) throws Exception {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) {
                throw new IllegalStateException("провайдер не отдал файл");
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[32 * 1024];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) > 0) {
                total += read;
                if (total > limit) {
                    throw new IllegalStateException("файл слишком большой");
                }
                out.write(buffer, 0, read);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private String displayName(Uri uri) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            try (Cursor cursor = getContext()
                .getContentResolver()
                .query(uri, new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    String name = cursor.getString(0);
                    if (name != null && !name.isEmpty()) {
                        return name;
                    }
                }
            } catch (Exception ignored) {
                // Fall through to the URI tail.
            }
        }
        String tail = uri.getLastPathSegment();
        return tail == null ? "audio" : tail;
    }

    /** Keeps Unicode letters but drops characters no filesystem tolerates. */
    static String safeName(String raw) {
        String base = raw == null ? "" : raw.trim();
        if (base.isEmpty()) {
            base = "track";
        }
        base = base.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (base.length() > 120) {
            int dot = base.lastIndexOf('.');
            String ext = dot > 0 && base.length() - dot <= 6 ? base.substring(dot) : "";
            base = base.substring(0, 120 - ext.length()) + ext;
        }
        return base;
    }

    /**
     * Re-importing the same folder must not pile up `song (2).mp3`: an existing
     * copy with the same size is reused, a different one gets a suffix.
     */
    private File uniqueTarget(File dir, String name, Uri source) {
        File candidate = new File(dir, name);
        if (!candidate.exists()) {
            return candidate;
        }
        long sourceSize = -1;
        try {
            sourceSize = documentSize(source);
        } catch (Exception ignored) {
            // Unknown size: assume the names collide and pick a suffix.
        }
        if (sourceSize >= 0 && candidate.length() == sourceSize) {
            return candidate;
        }
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 2; i < 1000; i += 1) {
            File next = new File(dir, stem + " (" + i + ")" + ext);
            if (!next.exists()) {
                return next;
            }
        }
        return new File(dir, System.currentTimeMillis() + ext);
    }

    private long documentSize(Uri uri) {
        try (Cursor cursor = getContext()
            .getContentResolver()
            .query(uri, new String[] { DocumentsContract.Document.COLUMN_SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) {
                return cursor.getLong(0);
            }
        } catch (Exception ignored) {
            // Unknown.
        }
        return -1;
    }
}
