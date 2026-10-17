package dev.myeyes.sample;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.ImageFormat;
import android.hardware.display.DisplayManager;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureFailure;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.AudioManager;
import android.media.Image;
import android.media.ImageReader;
import android.media.ToneGenerator;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Size;
import android.view.Surface;
import android.view.Display;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicLong;

/** User-started, visible camera foreground service. No boot/background auto-start. */
public final class ScannerService extends Service {
    static final String ACTION_START = "dev.myeyes.sample.START";
    static final String ACTION_STOP = "dev.myeyes.sample.STOP";
    private static final String CHANNEL = "myeyes-scanning";
    private static final int NOTIFICATION = 17;
    private static final long FRAME_INTERVAL_MS = 333, MAX_ALERT_AGE_MS = 2500;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final AtomicLong generation = new AtomicLong();
    private final Object lifecycle = new Object();
    private final CopyOnWriteArraySet<Listener> listeners = new CopyOnWriteArraySet<>();
    private final LocalBinder binder = new LocalBinder();
    private HandlerThread cameraThread;
    private Handler cameraHandler;
    private CameraDevice camera;
    private CameraCaptureSession captureSession;
    private ImageReader imageReader;
    private CameraCharacteristics characteristics;
    private boolean frameInFlight, awaitingImage;
    private long captureSerial, captureStarted, openingToken;
    private volatile boolean running, destroyed, openingCamera;
    private volatile ApiClient client;
    private volatile String sessionId;
    private volatile JSONArray zone = new JSONArray();
    private volatile long completedFrames;
    private long sequence, lastNotificationAt, lastAlertAt = -3000;
    private boolean alertSound, alertVibration;
    private ToneGenerator tone;
    private Vibrator vibrator;
    private Snapshot snapshot = Snapshot.idle("Ready when you are", "Start here, then open another app. Stop from this screen or the scanning notification.");

    interface Listener { void onSnapshot(Snapshot value); }

    static final class Snapshot {
        final boolean running, alert;
        final String status, detail;
        final long frames;
        final double latencyMs;
        final byte[] jpeg;
        final JSONArray detections, zone;
        Snapshot(boolean running, String status, String detail, long frames, double latencyMs,
                byte[] jpeg, JSONArray detections, JSONArray zone, boolean alert) {
            this.running = running; this.status = status; this.detail = detail; this.frames = frames;
            this.latencyMs = latencyMs; this.jpeg = jpeg; this.detections = detections; this.zone = zone; this.alert = alert;
        }
        static Snapshot idle(String status, String detail) {
            return new Snapshot(false, status, detail, 0, 0, null, new JSONArray(), new JSONArray(), false);
        }
    }

    public final class LocalBinder extends Binder { ScannerService getService() { return ScannerService.this; } }
    void addListener(Listener listener) { listeners.add(listener); listener.onSnapshot(snapshot); }
    void removeListener(Listener listener) { listeners.remove(listener); }
    @Override public IBinder onBind(Intent intent) { return binder; }

    @Override public void onCreate() {
        super.onCreate();
        cameraThread = new HandlerThread("myeyes-camera");
        cameraThread.start();
        cameraHandler = new Handler(cameraThread.getLooper());
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Active camera scanning", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shows scan status and lets you stop camera scanning.");
        channel.setSound(null, null);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
        try { tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80); }
        catch (RuntimeException ignored) { tone = null; }
        vibrator = Build.VERSION.SDK_INT >= 31
                ? getSystemService(VibratorManager.class).getDefaultVibrator()
                : (Vibrator) getSystemService(VIBRATOR_SERVICE);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) stopScanning("Stopped from the notification.");
        else if (intent != null && ACTION_START.equals(intent.getAction()) && !running) startScanning(intent);
        else if (!running) stopSelf();
        // Android must never restart this camera service without another visible Start tap.
        return START_NOT_STICKY;
    }

    private void startScanning(Intent intent) {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            setIdle("Camera permission needed", "Grant Camera from the visible app, then tap Start scanning.");
            stopSelf();
            return;
        }
        final ApiClient api;
        try { api = new ApiClient(intent.getStringExtra("backend")); }
        catch (RuntimeException error) { setIdle("Backend address needed", "Enter a valid backend address before starting."); stopSelf(); return; }
        alertSound = intent.getBooleanExtra("sound", true);
        alertVibration = intent.getBooleanExtra("vibration", true);
        final long token;
        synchronized (lifecycle) {
            token = generation.incrementAndGet();
            running = true; client = api; sessionId = null;
        }
        completedFrames = 0; sequence = 0; zone = new JSONArray(); lastAlertAt = -3000;
        try {
            if (Build.VERSION.SDK_INT >= 30) startForeground(NOTIFICATION, notification("Connecting to your backend"), ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA);
            else startForeground(NOTIFICATION, notification("Connecting to your backend"));
        } catch (RuntimeException error) {
            stopScanning("Could not start. Keep the app visible, grant Camera, then try again.");
            return;
        }
        publish(token, "Connecting to your backend", "Waiting for the real model before opening the rear camera.", null, new JSONArray(), 0, false);
        submitNetwork(() -> initializeApi(token, api));
    }

    private boolean active(long token) { return running && !destroyed && generation.get() == token; }

    private void initializeApi(long token, ApiClient api) {
        try {
            if (!active(token)) return;
            if (!api.ready().optBoolean("ready")) throw new java.io.IOException("The model is still loading.");
            if (!active(token)) return;
            JSONArray modelZone = api.model().getJSONArray("zone");
            if (!active(token)) return;
            String created = api.createSession(alertSound, alertVibration);
            boolean claimed;
            synchronized (lifecycle) {
                claimed = active(token);
                if (claimed) { sessionId = created; sequence = 0; zone = modelZone; }
            }
            if (!claimed) { deleteQuietly(api.baseUrl, created); return; }
            cameraHandler.post(() -> ensureCamera(token, api));
        } catch (Exception error) {
            if (!active(token)) return;
            publish(token, "Analysis unavailable", "Check the backend address, server readiness, and connection. Retrying in 2 seconds.", null, new JSONArray(), 0, false);
            cameraHandler.postDelayed(() -> { if (active(token)) submitNetwork(() -> initializeApi(token, api)); }, 2000);
        }
    }

    private void ensureCamera(long token, ApiClient api) {
        if (!active(token)) return;
        if (captureSession != null && camera != null) captureNext(token, api);
        else if (!openingCamera) openCamera(token, api);
        else cameraHandler.postDelayed(() -> ensureCamera(token, api), 100);
    }

    private void openCamera(long token, ApiClient api) {
        try {
            CameraManager manager = getSystemService(CameraManager.class);
            String cameraId = null;
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics candidate = manager.getCameraCharacteristics(id);
                Integer facing = candidate.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    cameraId = id; characteristics = candidate; break;
                }
            }
            if (cameraId == null) throw new IllegalStateException("No rear camera is available.");
            StreamConfigurationMap map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            Size[] options = map == null ? null : map.getOutputSizes(ImageFormat.JPEG);
            if (options == null) throw new IllegalStateException("This rear camera has no JPEG output.");
            Size size = Arrays.stream(options).filter(value -> value.getWidth() <= 640 && value.getHeight() <= 640)
                    .max(Comparator.comparingLong(value -> (long) value.getWidth() * value.getHeight()))
                    .orElseThrow(() -> new IllegalStateException("This camera has no JPEG size at or below 640 pixels."));
            imageReader = ImageReader.newInstance(size.getWidth(), size.getHeight(), ImageFormat.JPEG, 2);
            imageReader.setOnImageAvailableListener(reader -> receiveImage(token, api, reader), cameraHandler);
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) throw new SecurityException("Camera permission was revoked.");
            openingCamera = true; openingToken = token;
            manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice device) {
                    if (openingToken == token) openingCamera = false;
                    if (!active(token)) { device.close(); finishCameraThreadIfDestroyed(); return; }
                    camera = device;
                    try {
                        device.createCaptureSession(Collections.singletonList(imageReader.getSurface()), new CameraCaptureSession.StateCallback() {
                            @Override public void onConfigured(CameraCaptureSession session) {
                                if (!active(token)) { session.close(); return; }
                                captureSession = session;
                                captureNext(token, api);
                            }
                            @Override public void onConfigureFailed(CameraCaptureSession session) {
                                session.close(); failCamera(token, "The camera could not configure a capture session.");
                            }
                        }, cameraHandler);
                    } catch (Exception error) { failCamera(token, "The camera could not start. Close other camera apps and retry."); }
                }
                @Override public void onDisconnected(CameraDevice device) {
                    if (openingToken == token) openingCamera = false;
                    device.close();
                    failCamera(token, "Camera access ended. Return to Clarity and tap Start again.");
                    finishCameraThreadIfDestroyed();
                }
                @Override public void onError(CameraDevice device, int error) {
                    if (openingToken == token) openingCamera = false;
                    device.close();
                    failCamera(token, "Camera unavailable. Another app may be using it. Return here and restart.");
                    finishCameraThreadIfDestroyed();
                }
            }, cameraHandler);
        } catch (Exception error) {
            openingCamera = false;
            failCamera(token, error.getMessage() == null ? "Rear camera unavailable." : error.getMessage());
        }
    }

    private void captureNext(long token, ApiClient api) {
        if (!active(token) || frameInFlight || captureSession == null || camera == null || sessionId == null) return;
        try {
            frameInFlight = true; awaitingImage = true; captureStarted = SystemClock.elapsedRealtime();
            final long serial = ++captureSerial;
            CaptureRequest.Builder request = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            request.addTarget(imageReader.getSurface());
            request.set(CaptureRequest.JPEG_QUALITY, (byte) 70);
            request.set(CaptureRequest.JPEG_ORIENTATION, jpegOrientation());
            int[] modes = characteristics.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES);
            if (modes != null && Arrays.stream(modes).anyMatch(mode -> mode == CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)) {
                request.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
            }
            captureSession.capture(request.build(), new CameraCaptureSession.CaptureCallback() {
                @Override public void onCaptureFailed(CameraCaptureSession session, CaptureRequest request, CaptureFailure failure) {
                    failCamera(token, "A camera frame could not be captured. Return here and restart.");
                }
            }, cameraHandler);
            cameraHandler.postDelayed(() -> {
                if (active(token) && awaitingImage && captureSerial == serial) failCamera(token, "Camera capture stalled. Stop and start again.");
            }, 5000);
        } catch (Exception error) { failCamera(token, "Camera capture failed. Close other camera apps and restart."); }
    }

    private int jpegOrientation() {
        Display display = getSystemService(DisplayManager.class).getDisplay(Display.DEFAULT_DISPLAY);
        int rotation = display == null ? Surface.ROTATION_0 : display.getRotation();
        int degrees = rotation == Surface.ROTATION_90 ? 90 : rotation == Surface.ROTATION_180 ? 180 : rotation == Surface.ROTATION_270 ? 270 : 0;
        Integer sensor = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION);
        return ((sensor == null ? 0 : sensor) - degrees + 360) % 360;
    }

    private void receiveImage(long token, ApiClient api, ImageReader reader) {
        try (Image image = reader.acquireLatestImage()) {
            if (image == null || !active(token)) return;
            awaitingImage = false;
            ByteBuffer bytes = image.getPlanes()[0].getBuffer();
            if (bytes.remaining() == 0 || bytes.remaining() > 1_048_576) {
                failCamera(token, "Camera produced an oversized or empty frame. No frame was uploaded.");
                return;
            }
            byte[] jpeg = new byte[bytes.remaining()];
            bytes.get(jpeg);
            final long started = captureStarted;
            submitNetwork(() -> analyzeFrame(token, api, jpeg, started));
        } catch (Exception error) { failCamera(token, "Camera image could not be read. Stop and start again."); }
    }

    private void analyzeFrame(long token, ApiClient api, byte[] jpeg, long started) {
        long retryDelay = FRAME_INTERVAL_MS;
        boolean reconnect = false;
        try {
            if (!active(token)) return;
            String id = sessionId;
            if (id == null) { reconnect = true; return; }
            JSONObject result = api.frame(id, ++sequence, jpeg);
            if (!active(token)) return;
            long latency = SystemClock.elapsedRealtime() - started;
            completedFrames++;
            JSONArray detections = result.getJSONArray("detections");
            JSONObject decision = result.getJSONObject("alert");
            boolean trigger = decision.optBoolean("triggered") && latency <= MAX_ALERT_AGE_MS;
            String detail;
            if (latency > MAX_ALERT_AGE_MS) detail = "Result arrived late; alert skipped. Capturing a fresh frame.";
            else if (trigger) detail = decision.optString("message", "Object in camera zone. Check your surroundings.");
            else if (detections.length() == 0) detail = "No supported object detected in the last frame.";
            else detail = detections.length() + " supported object(s) detected · " + decision.optString("reason", "observed");
            publish(token, trigger ? "Object in camera zone" : "Scanning · you can switch apps", detail, jpeg, detections, latency, trigger);
            retryDelay = Math.max(0, FRAME_INTERVAL_MS - latency);
        } catch (Exception error) {
            if (!active(token)) return;
            if (error instanceof ApiClient.ApiException && ((ApiClient.ApiException) error).status == 404) {
                synchronized (lifecycle) { if (active(token)) sessionId = null; }
                reconnect = true;
            }
            publish(token, "Analysis unavailable", "No alert from this frame. Check the backend connection; retrying with a fresh frame.", null, new JSONArray(), 0, false);
            retryDelay = 1000;
        } finally {
            final boolean newSession = reconnect;
            final long delay = retryDelay;
            cameraHandler.post(() -> {
                if (!active(token)) return;
                frameInFlight = false;
                if (newSession) submitNetwork(() -> initializeApi(token, api));
                else cameraHandler.postDelayed(() -> captureNext(token, api), delay);
            });
        }
    }

    private void publish(long token, String status, String detail, byte[] jpeg, JSONArray detections, double latencyMs, boolean alert) {
        final long frames = completedFrames;
        main.post(() -> {
            if (!active(token)) return;
            snapshot = new Snapshot(true, status, detail, frames, latencyMs, jpeg, detections, zone, alert);
            for (Listener listener : listeners) listener.onSnapshot(snapshot);
            long now = SystemClock.elapsedRealtime();
            if (alert && now - lastAlertAt >= 3000) { lastAlertAt = now; testAlert(alertSound, alertVibration); }
            if (alert || now - lastNotificationAt >= 1000) {
                lastNotificationAt = now;
                getSystemService(NotificationManager.class).notify(NOTIFICATION, notification(status));
            }
        });
    }

    void testAlert(boolean sound, boolean vibration) {
        if (sound && tone != null) tone.startTone(ToneGenerator.TONE_PROP_BEEP, 180);
        if (vibration && vibrator != null && vibrator.hasVibrator()) {
            vibrator.vibrate(VibrationEffect.createWaveform(new long[] {0, 160, 70, 160}, -1));
        }
    }

    void stopScanning(String reason) {
        final ApiClient previous;
        final String previousSession;
        synchronized (lifecycle) {
            running = false;
            generation.incrementAndGet();
            previous = client; previousSession = sessionId;
            client = null; sessionId = null;
        }
        if (previous != null) previous.cancel();
        if (cameraHandler != null) cameraHandler.post(this::closeCamera);
        if (tone != null) tone.stopTone();
        if (vibrator != null) vibrator.cancel();
        if (previous != null && previousSession != null) submitNetwork(() -> deleteQuietly(previous.baseUrl, previousSession));
        stopForeground(STOP_FOREGROUND_REMOVE);
        setIdle("Scanning stopped", reason);
        stopSelf();
    }

    private void failCamera(long token, String reason) { main.post(() -> { if (active(token)) stopScanning(reason); }); }

    private void closeCamera() {
        frameInFlight = false; awaitingImage = false;
        if (captureSession != null) { captureSession.close(); captureSession = null; }
        if (camera != null) { camera.close(); camera = null; }
        if (imageReader != null) { imageReader.close(); imageReader = null; }
        finishCameraThreadIfDestroyed();
    }

    private void finishCameraThreadIfDestroyed() { if (destroyed && !openingCamera) cameraThread.quitSafely(); }

    private void setIdle(String status, String detail) {
        snapshot = Snapshot.idle(status, detail);
        for (Listener listener : listeners) listener.onSnapshot(snapshot);
    }

    private void submitNetwork(Runnable task) {
        try { network.execute(task); }
        catch (RejectedExecutionException ignored) { /* Service has already been destroyed. */ }
    }

    private static void deleteQuietly(String baseUrl, String id) {
        try { new ApiClient(baseUrl).deleteSession(id); }
        catch (Exception ignored) { /* The server also expires abandoned sessions. */ }
    }

    private Notification notification(String detail) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, ScannerService.class).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_scan).setContentTitle("Clarity · camera scanning")
                .setContentText(detail).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .addAction(new Notification.Action.Builder(null, "Stop", stop).build()).build();
    }

    @Override public void onDestroy() {
        stopScanning("The scanning service ended. Tap Start to begin again.");
        destroyed = true;
        cameraHandler.post(this::closeCamera);
        network.shutdown();
        if (tone != null) { tone.release(); tone = null; }
        listeners.clear();
        super.onDestroy();
    }
}
