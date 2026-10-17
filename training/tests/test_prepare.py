import importlib.util
import pathlib
import unittest

PATH = pathlib.Path(__file__).parents[1] / 'prepare_coco.py'

class SplitTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(PATH.exists(), 'dataset preparation implementation missing')
        spec = importlib.util.spec_from_file_location('prepare', PATH)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        self.doc = {'images':[{'id':i,'file_name':f'{i}.jpg'} for i in range(20)], 'annotations':[{'id':i,'image_id':i,'category_id':1+i%4} for i in range(20)], 'categories':[{'id':i} for i in range(1,5)], 'licenses':[{'id':1}]}
    def test_seeded_selection_is_reproducible_and_balanced(self):
        ids = self.m.select_balanced(self.doc, 8, 42)
        self.assertEqual(ids, self.m.select_balanced(self.doc,8,42))
        self.assertEqual(len(ids),8)
        subset = self.m.subset(self.doc, ids)
        self.assertEqual({a['category_id'] for a in subset['annotations']}, {1,2,3,4})
        self.assertEqual(subset['categories'], self.doc['categories'])
        self.assertEqual(subset['licenses'], self.doc['licenses'])
    def test_subsets_keep_every_annotation_and_split_has_no_overlap(self):
        self.doc['annotations'].append({'id':50,'image_id':0,'category_id':4})
        self.assertEqual(len(self.m.subset(self.doc,[0])['annotations']),2)
        val,test = self.m.split_validation(self.doc,42)
        self.assertFalse(set(val)&set(test))
        self.assertEqual(set(val)|set(test),set(range(20)))
    def test_oversize_or_empty_rejected(self):
        for count in (0,21):
            with self.assertRaises(ValueError): self.m.select_balanced(self.doc,count,42)

if __name__ == '__main__': unittest.main()

class LeakageTests(unittest.TestCase):
    def test_cross_split_duplicate_hash_rejected(self):
        spec=importlib.util.spec_from_file_location('prepare',PATH)
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        self.assertTrue(hasattr(module,'audit_splits'),'split leakage audit missing')
        with self.assertRaises(ValueError):
            module.audit_splits({'train':{1:'abc'},'test':{2:'abc'}})
        with self.assertRaises(ValueError):
            module.audit_splits({'train':{1:'abc'},'test':{1:'def'}})
        self.assertEqual(module.audit_splits({'train':{1:'abc'},'test':{2:'def'}})['cross_split_duplicates'],0)
