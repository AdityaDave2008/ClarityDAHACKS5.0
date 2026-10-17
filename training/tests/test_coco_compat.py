import importlib.util
import pathlib
import unittest

PATH=pathlib.Path(__file__).parents[1]/'coco_compat.py'

class CocoCompatibilityTests(unittest.TestCase):
    def test_metadata_remains_compatible_with_load_results(self):
        self.assertTrue(PATH.exists(),'COCO compatibility implementation missing')
        try:
            from pycocotools.coco import COCO
            from yolox.data.datasets.coco import remove_useless_info
        except ImportError:
            self.skipTest('GPU environment integration test requires pinned pycocotools and YOLOX')
        spec=importlib.util.spec_from_file_location('compat',PATH)
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        coco=COCO()
        coco.dataset={'info':{'description':'metadata'},'images':[{'id':1,'width':20,'height':20}],
                      'categories':[{'id':1,'name':'person'}], 'annotations':[]}
        coco.createIndex()
        mod.cleanup_preserving_info(coco,remove_useless_info)
        result=coco.loadRes([{'image_id':1,'category_id':1,'bbox':[1,1,5,5],'score':.8}])
        self.assertEqual(result.dataset['info']['description'],'metadata')
        self.assertEqual(len(result.dataset['annotations']),1)

    def test_numpy_category_id_serializes_after_conversion(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest('NumPy not installed in local standard-library test environment')
        import json
        spec=importlib.util.spec_from_file_location('compat',PATH)
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        self.assertEqual(json.loads(json.dumps({'category_id':mod.category_id_for_json(np.int64(1))})),{'category_id':1})

    def test_standard_evaluator_avoids_optional_runtime_cpp_build(self):
        spec=importlib.util.spec_from_file_location('compat',PATH)
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        self.assertTrue(hasattr(mod,'install_standard_evaluator'),'standard evaluator hook missing')
        try:
            import yolox.layers
            from pycocotools.cocoeval import COCOeval
        except ImportError:
            self.skipTest('Pinned GPU environment integration test')
        mod.install_standard_evaluator()
        self.assertIs(yolox.layers.COCOeval_opt,COCOeval)
