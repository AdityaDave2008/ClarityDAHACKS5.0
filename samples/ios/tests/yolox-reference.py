"""Independent OpenCV + ONNX CPU reference. Usage: python yolox-reference.py model.onnx image.jpg
Requires existing onnxruntime, numpy, opencv-python. No network or model downloads.
"""
import sys, json
import cv2
import numpy as np
import onnxruntime as ort
image = cv2.imread(sys.argv[2])
assert image is not None
h, w = image.shape[:2]
ratio = min(416 / h, 416 / w)
padded = np.full((416, 416, 3), 114, dtype=np.uint8)
padded[:int(h*ratio), :int(w*ratio)] = cv2.resize(image, (int(w*ratio), int(h*ratio)), interpolation=cv2.INTER_LINEAR)
session = ort.InferenceSession(sys.argv[1], providers=['CPUExecutionProvider'])
rows = session.run(None, {'images': padded.transpose(2,0,1)[None].astype(np.float32)})[0][0]
scores = rows[:,4] * rows[:,5:].max(axis=1)
order = scores.argsort()[::-1]
kept = []
for i in order:
    if scores[i] < .4: break
    cls = int(rows[i,5:].argmax())
    cx,cy,bw,bh = rows[i,:4].astype(float) / ratio
    box = np.array([cx-bw/2, cy-bh/2, cx+bw/2, cy+bh/2])
    def overlap(other):
        inter = np.maximum(0,np.minimum(box[2:],other[2:])-np.maximum(box[:2],other[:2])).prod()
        return inter / (bw*bh + (other[2:]-other[:2]).prod()-inter)
    if any(cls==item[0] and overlap(item[2])>.65 for item in kept): continue
    kept.append((cls,float(scores[i]),box))
result=[]
for cls,score,box in kept:
    box[0::2]=np.clip(box[0::2],0,w);box[1::2]=np.clip(box[1::2],0,h)
    result.append({'classIndex':cls,'score':score,'bbox':[box[0]/w,box[1]/h,(box[2]-box[0])/w,(box[3]-box[1])/h]})
print(json.dumps({'runtime':ort.__version__,'opencv':cv2.__version__,'width':w,'height':h,'detections':result},indent=2))
