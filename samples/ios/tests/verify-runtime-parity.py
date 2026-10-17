"""Compare actual WKWebView tensor/output with independent ONNX CPU, plus decode diagnostics.
Usage: python verify-runtime-parity.py model.onnx image.jpg boundaries.json
"""
import sys,json
import numpy as np
import cv2
import onnxruntime as ort
j=json.load(open(sys.argv[3]))
x=np.array(j['input'],np.float32).reshape(1,3,416,416)
actual=np.array(j['output'],np.float32).reshape(1,3549,85)
session=ort.InferenceSession(sys.argv[1],providers=['CPUExecutionProvider'])
expected=session.run(None,{'images':x})[0]
np.testing.assert_allclose(actual,expected,rtol=1e-4,atol=.002)
web=np.array(j['rgba'],np.uint8).reshape(j['height'],j['width'],4)[:,:,:3][:,:,::-1]
cv=cv2.imread(sys.argv[2]);delta=np.abs(web.astype(int)-cv.astype(int))
print('PASS identical-tensor runtime parity, all 301665 output values; max absolute delta',float(np.abs(actual-expected).max()))
print('Platform image decode difference: max',int(delta.max()),'mean',float(delta.mean()))
