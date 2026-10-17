package dev.myeyes.sample;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.media.ExifInterface;
import android.view.View;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;

/** Shows the last analyzed camera frame, not a fictitious live detector preview. */
final class FrameView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF content = new RectF();
    private Bitmap bitmap;
    private byte[] source;
    private JSONArray detections = new JSONArray();
    private JSONArray zone = new JSONArray();

    FrameView(Context context) { super(context); setContentDescription("Last analyzed camera frame and detected object boxes"); }

    void show(ScannerService.Snapshot snapshot) {
        detections = snapshot.detections;
        zone = snapshot.zone;
        if (snapshot.jpeg != source) {
            source = snapshot.jpeg;
            Bitmap next = null;
            if (source != null) {
                Bitmap decoded = BitmapFactory.decodeByteArray(source, 0, source.length);
                if (decoded != null) {
                    Matrix rotation = new Matrix();
                    try {
                        ExifInterface exif = new ExifInterface(new ByteArrayInputStream(source));
                        switch (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                            case ExifInterface.ORIENTATION_ROTATE_90: rotation.postRotate(90); break;
                            case ExifInterface.ORIENTATION_ROTATE_180: rotation.postRotate(180); break;
                            case ExifInterface.ORIENTATION_ROTATE_270: rotation.postRotate(270); break;
                            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: rotation.postScale(-1, 1); break;
                            case ExifInterface.ORIENTATION_FLIP_VERTICAL: rotation.postScale(1, -1); break;
                            case ExifInterface.ORIENTATION_TRANSPOSE: rotation.postRotate(90); rotation.postScale(-1, 1); break;
                            case ExifInterface.ORIENTATION_TRANSVERSE: rotation.postRotate(270); rotation.postScale(-1, 1); break;
                            default: break;
                        }
                    } catch (Exception ignored) { /* Missing EXIF means pixels are already oriented. */ }
                    next = Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), rotation, true);
                }
            }
            bitmap = next;
        }
        invalidate();
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawColor(Color.rgb(10, 35, 41));
        paint.setStyle(Paint.Style.FILL);
        if (bitmap == null) {
            paint.setColor(Color.rgb(145, 180, 184));
            paint.setTextSize(14 * getResources().getDisplayMetrics().scaledDensity);
            paint.setTextAlign(Paint.Align.CENTER);
            canvas.drawText("Your analyzed frames appear here", getWidth() / 2f, getHeight() / 2f, paint);
            paint.setTextAlign(Paint.Align.LEFT);
            return;
        }
        float scale = Math.min((float) getWidth() / bitmap.getWidth(), (float) getHeight() / bitmap.getHeight());
        float width = bitmap.getWidth() * scale, height = bitmap.getHeight() * scale;
        content.set((getWidth() - width) / 2, (getHeight() - height) / 2,
                (getWidth() + width) / 2, (getHeight() + height) / 2);
        canvas.drawBitmap(bitmap, null, content, paint);
        Path path = new Path();
        for (int i = 0; i < zone.length(); i++) {
            JSONObject point = zone.optJSONObject(i);
            if (point == null) continue;
            float x = content.left + (float) point.optDouble("x") * width;
            float y = content.top + (float) point.optDouble("y") * height;
            if (i == 0) path.moveTo(x, y); else path.lineTo(x, y);
        }
        path.close();
        paint.setColor(0x3354E3C1);
        canvas.drawPath(path, paint);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2 * getResources().getDisplayMetrics().density);
        paint.setColor(0xFF54E3C1);
        canvas.drawPath(path, paint);
        for (int i = 0; i < detections.length(); i++) {
            JSONObject object = detections.optJSONObject(i);
            JSONObject box = object == null ? null : object.optJSONObject("bbox");
            if (box == null) continue;
            float left = content.left + (float) box.optDouble("x") * width;
            float top = content.top + (float) box.optDouble("y") * height;
            float right = left + (float) box.optDouble("width") * width;
            float bottom = top + (float) box.optDouble("height") * height;
            paint.setColor(object.optBoolean("inZone") ? 0xFFFFCB70 : 0xFF54E3C1);
            paint.setStyle(Paint.Style.STROKE);
            canvas.drawRoundRect(left, top, right, bottom, 6, 6, paint);
            paint.setStyle(Paint.Style.FILL);
            paint.setTextSize(12 * getResources().getDisplayMetrics().scaledDensity);
            canvas.drawText(object.optString("label"), left + 4, Math.max(content.top + 16, top - 6), paint);
        }
        paint.setStyle(Paint.Style.FILL);
    }
}
