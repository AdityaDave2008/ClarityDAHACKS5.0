package dev.stepsense.sample;

import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** The existing backend performs all inference. Camera bytes are never saved locally. */
final class ApiClient {
    final String baseUrl;
    private volatile HttpURLConnection active;
    private volatile boolean cancelled;

    ApiClient(String baseUrl) {
        this.baseUrl = validateBaseUrl(baseUrl);
    }

    static String validateBaseUrl(String text) {
        String value = text.trim();
        URI uri;
        try { uri = URI.create(value); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("Enter the backend's full HTTP or HTTPS address."); }
        if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                || uri.getHost() == null || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null || uri.getRawFragment() != null
                || (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !"/".equals(uri.getRawPath()))) {
            throw new IllegalArgumentException("Use the backend's HTTP(S) origin and port, without /api/v1, another path, a password, or a query.");
        }
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }

    JSONObject ready() throws Exception { return request("GET", "/ready", null, null, 0); }
    JSONObject model() throws Exception { return request("GET", "/api/v1/model", null, null, 0); }

    String createSession(boolean sound, boolean vibration) throws Exception {
        JSONArray modes = new JSONArray();
        if (sound) modes.put("sound");
        if (vibration) modes.put("vibration");
        JSONObject preferences = new JSONObject()
                .put("alertModes", modes).put("confidenceThreshold", 0.6).put("cooldownMs", 3000);
        JSONObject body = new JSONObject().put("preset", "standard").put("preferences", preferences);
        return request("POST", "/api/v1/sessions", body.toString().getBytes(StandardCharsets.UTF_8),
                "application/json", 0).getString("sessionId");
    }

    JSONObject frame(String sessionId, long sequence, byte[] jpeg) throws Exception {
        return request("POST", "/api/v1/sessions/" + Uri.encode(sessionId) + "/frames",
                jpeg, "image/jpeg", sequence);
    }

    void deleteSession(String sessionId) throws Exception {
        request("DELETE", "/api/v1/sessions/" + Uri.encode(sessionId), null, null, 0);
    }

    void cancel() {
        cancelled = true;
        HttpURLConnection connection = active;
        if (connection != null) connection.disconnect();
    }

    private JSONObject request(String method, String path, byte[] body, String contentType, long sequence) throws Exception {
        if (cancelled) throw new IOException("Scan stopped.");
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
        active = connection;
        try {
            if (cancelled) throw new IOException("Scan stopped.");
            connection.setRequestMethod(method);
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(5000);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "application/json");
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", contentType);
                if (sequence > 0) connection.setRequestProperty("X-Frame-Sequence", Long.toString(sequence));
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            }
            int status = connection.getResponseCode();
            String text = readBounded(status >= 200 && status < 300
                    ? connection.getInputStream() : connection.getErrorStream());
            if (status < 200 || status >= 300) {
                String message = "Backend returned HTTP " + status + ".";
                try { message = new JSONObject(text).getJSONObject("error").getString("message"); }
                catch (Exception ignored) { /* Proxies may return non-JSON errors. */ }
                throw new ApiException(status, message);
            }
            return text.isEmpty() ? new JSONObject() : new JSONObject(text);
        } finally {
            active = null;
            connection.disconnect();
        }
    }

    private static String readBounded(InputStream input) throws IOException {
        if (input == null) return "";
        try (InputStream stream = input; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            for (int count; (count = stream.read(buffer)) != -1; ) {
                if (bytes.size() + count > 65536) throw new IOException("Unexpectedly large backend response.");
                bytes.write(buffer, 0, count);
            }
            return bytes.toString(StandardCharsets.UTF_8.name());
        }
    }

    static final class ApiException extends IOException {
        final int status;
        ApiException(int status, String message) { super(message); this.status = status; }
    }
}
