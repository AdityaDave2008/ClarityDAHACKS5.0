package dev.myeyes.sample;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int PERMISSIONS = 41;
    private static final int INK = 0xFF071B20, CARD = 0xFF102C33, TEAL = 0xFF54E3C1;
    private EditText backend;
    private Switch sound, vibration;
    private Button start, stop;
    private TextView status, detail, metrics;
    private FrameView frameView;
    private ScannerService service;
    private boolean bound, resumed, permissionStart;
    private SharedPreferences preferences;
    private final ScannerService.Listener listener = this::render;
    private final ServiceConnection connection = new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((ScannerService.LocalBinder) binder).getService();
            service.addListener(listener);
        }
        @Override public void onServiceDisconnected(ComponentName name) {
            service = null;
            start.setEnabled(false);
            stop.setEnabled(false);
            status.setText("Service disconnected");
            detail.setText("Return to this screen to reconnect.");
        }
    };

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferences = getSharedPreferences("settings", MODE_PRIVATE);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(INK);
        scroll.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(24), dp(24), dp(28));
        scroll.addView(root);
        setContentView(scroll);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(dp(24) + bars.left, dp(24) + bars.top, dp(24) + bars.right, dp(28) + bars.bottom);
            } else {
                view.setPadding(dp(24) + insets.getSystemWindowInsetLeft(), dp(24) + insets.getSystemWindowInsetTop(),
                        dp(24) + insets.getSystemWindowInsetRight(), dp(28) + insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        TextView eyebrow = text("NATIVE ANDROID SAMPLE", 11, TEAL);
        eyebrow.setLetterSpacing(0.18f);
        root.addView(eyebrow);
        TextView title = text("Clarity", 38, Color.WHITE);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        add(root, title, 8);
        add(root, text("Scan ahead for selected objects and choose sound or vibration alerts.", 16, 0xFFACC5C9), 4);

        LinearLayout settings = card(root, 24);
        TextView setupTitle = text("Connect your backend", 19, Color.WHITE);
        setupTitle.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        settings.addView(setupTitle);
        add(settings, text("Clarity sends camera frames to this server to check for selected objects. The server does not save the images.", 13, 0xFFACC5C9), 8);
        backend = new EditText(this);
        backend.setSingleLine(true);
        backend.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        backend.setText(preferences.getString("backend", "http://10.0.2.2:3001"));
        backend.setTextSize(14);
        backend.setTextColor(Color.WHITE);
        backend.setHintTextColor(0xFFACC5C9);
        backend.setHint("https://your-backend.example");
        backend.setContentDescription("Backend server address");
        backend.setPadding(dp(12), dp(12), dp(12), dp(12));
        backend.setBackground(background(0xFF071F25, 10));
        add(settings, backend, 14);

        sound = toggle("Sound alert", preferences.getBoolean("sound", true));
        vibration = toggle("Vibration alert", preferences.getBoolean("vibration", true));
        add(settings, sound, 12);
        add(settings, vibration, 2);
        Button testAlert = button("Test selected alerts", false);
        testAlert.setOnClickListener(view -> {
            if (service != null) service.testAlert(sound.isChecked(), vibration.isChecked());
            Toast.makeText(this, "Test alert — no camera detection involved", Toast.LENGTH_SHORT).show();
        });
        add(settings, testAlert, 8);

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        start = button("Start scanning", true);
        stop = button("Stop", false);
        start.setEnabled(false);
        stop.setEnabled(false);
        controls.addView(start, new LinearLayout.LayoutParams(0, dp(54), 2));
        LinearLayout.LayoutParams stopLayout = new LinearLayout.LayoutParams(0, dp(54), 1);
        stopLayout.setMarginStart(dp(10));
        controls.addView(stop, stopLayout);
        add(root, controls, 20);
        start.setOnClickListener(view -> requestStart());
        stop.setOnClickListener(view -> { if (service != null) service.stopScanning("Stopped by you."); });

        LinearLayout stateCard = card(root, 20);
        status = text("Ready when you are", 19, TEAL);
        status.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        stateCard.addView(status);
        detail = text("Start here, then open another app. The notification keeps a Stop action within reach.", 14, 0xFFD8E6E7);
        add(stateCard, detail, 8);
        metrics = text("No frames analyzed yet", 12, 0xFF8EB1B8);
        add(stateCard, metrics, 10);

        add(root, text("LAST ANALYZED FRAME", 11, 0xFF8EB1B8), 24);
        frameView = new FrameView(this);
        frameView.setMinimumHeight(dp(250));
        root.addView(frameView, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(290)));
        add(root, text("Keep the rear camera pointed ahead. Clarity only detects selected objects and has not been tested as a navigation aid.", 12, 0xFF8EB1B8), 14);
    }

    @Override protected void onStart() {
        super.onStart();
        bound = bindService(new Intent(this, ScannerService.class), connection, Context.BIND_AUTO_CREATE);
    }

    @Override protected void onResume() { super.onResume(); resumed = true; }
    @Override protected void onPause() { resumed = false; super.onPause(); }

    @Override protected void onStop() {
        if (service != null) service.removeListener(listener);
        if (bound) unbindService(connection);
        bound = false;
        service = null;
        // A user-started foreground camera service deliberately survives app switching.
        super.onStop();
    }

    private void requestStart() {
        try { ApiClient.validateBaseUrl(backend.getText().toString()); }
        catch (IllegalArgumentException error) { backend.setError(error.getMessage()); return; }
        ArrayList<String> needed = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) needed.add(Manifest.permission.CAMERA);
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && !preferences.getBoolean("askedNotifications", false)) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS);
            preferences.edit().putBoolean("askedNotifications", true).apply();
        }
        if (!needed.isEmpty()) {
            permissionStart = true;
            requestPermissions(needed.toArray(new String[0]), PERMISSIONS);
        } else startScanning();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != PERMISSIONS || !permissionStart) return;
        permissionStart = false;
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            status.setText("Camera permission needed");
            detail.setText("Allow Camera in Android Settings, then return and tap Start scanning.");
        } else if (resumed) startScanning();
        else detail.setText("Permission granted. Tap Start scanning while this screen is visible.");
    }

    private void startScanning() {
        if (!resumed || service == null) return;
        String url;
        try { url = ApiClient.validateBaseUrl(backend.getText().toString()); }
        catch (IllegalArgumentException error) { backend.setError(error.getMessage()); return; }
        preferences.edit().putString("backend", url).putBoolean("sound", sound.isChecked())
                .putBoolean("vibration", vibration.isChecked()).apply();
        Intent intent = new Intent(this, ScannerService.class).setAction(ScannerService.ACTION_START)
                .putExtra("backend", url).putExtra("sound", sound.isChecked()).putExtra("vibration", vibration.isChecked());
        try {
            // This call occurs only from the visible, permission-granted activity.
            startForegroundService(intent);
            start.setEnabled(false);
        } catch (RuntimeException error) {
            status.setText("Could not start camera service");
            detail.setText("Keep this screen visible and grant Camera, then try again.");
            start.setEnabled(true);
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Notifications are disabled. Return here to stop; Android also shows the active service in its task manager.", Toast.LENGTH_LONG).show();
        }
    }

    private void render(ScannerService.Snapshot snapshot) {
        status.setText(snapshot.status);
        status.setTextColor(snapshot.alert ? 0xFFFFCB70 : TEAL);
        detail.setText(snapshot.detail);
        metrics.setText(snapshot.frames == 0 ? "No frames analyzed yet"
                : String.format(Locale.US, "%d frames analyzed  ·  %.0f ms last capture + request", snapshot.frames, snapshot.latencyMs));
        start.setEnabled(!snapshot.running);
        stop.setEnabled(snapshot.running);
        backend.setEnabled(!snapshot.running);
        sound.setEnabled(!snapshot.running);
        vibration.setEnabled(!snapshot.running);
        frameView.show(snapshot);
    }

    private TextView text(String value, float size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setLineSpacing(dp(3), 1);
        return view;
    }

    private Switch toggle(String label, boolean checked) {
        Switch view = new Switch(this);
        view.setText(label);
        view.setTextColor(Color.WHITE);
        view.setTextSize(15);
        view.setChecked(checked);
        view.setMinHeight(dp(48));
        return view;
    }

    private Button button(String label, boolean primary) {
        Button view = new Button(this);
        view.setText(label);
        view.setAllCaps(false);
        view.setTextSize(14);
        view.setTextColor(primary ? INK : TEAL);
        view.setBackground(background(primary ? TEAL : CARD, 12));
        view.setMinHeight(dp(50));
        return view;
    }

    private LinearLayout card(LinearLayout root, int top) {
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.VERTICAL);
        view.setPadding(dp(18), dp(18), dp(18), dp(18));
        view.setBackground(background(CARD, 18));
        add(root, view, top);
        return view;
    }

    private void add(LinearLayout parent, View child, int top) {
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        layout.topMargin = dp(top);
        parent.addView(child, layout);
    }

    private GradientDrawable background(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
