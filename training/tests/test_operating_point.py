import importlib.util
import pathlib
import unittest
PATH=pathlib.Path(__file__).parents[1]/'operating_point.py'
class OperatingPointTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(PATH.exists(),'operating point implementation missing')
        spec=importlib.util.spec_from_file_location('op',PATH)
        self.m=importlib.util.module_from_spec(spec); spec.loader.exec_module(self.m)
    def test_max_recall_with_required_precision(self):
        result=self.m.choose_threshold([(0.9,True),(0.8,True),(0.7,False)],4,0.935)
        self.assertEqual(result['threshold'],0.8)
        self.assertEqual(result['precision'],1)
        self.assertEqual(result['recall'],0.5)
    def test_equal_scores_not_split(self):
        result=self.m.choose_threshold([(0.9,True),(0.9,False)],2,0.935)
        self.assertIsNone(result['threshold'])
        self.assertFalse(result['target_met'])
    def test_empty_is_not_claimed_success(self):
        self.assertFalse(self.m.choose_threshold([],2,.935)['target_met'])
if __name__=='__main__': unittest.main()

class FixedPointTests(unittest.TestCase):
    def test_fixed_threshold_reports_false_negatives_and_target_failure(self):
        spec=importlib.util.spec_from_file_location('op',PATH)
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        self.assertTrue(hasattr(mod,'fixed_threshold'),'fixed threshold metrics missing')
        r=mod.fixed_threshold([(0.9,True),(0.8,False),(0.1,True)],5,.5)
        self.assertEqual((r['true_positives'],r['false_positives'],r['false_negatives']),(1,1,4))
        self.assertEqual(r['precision'],.5)
        self.assertEqual(r['recall'],.2)
        self.assertFalse(r['target_met'])
