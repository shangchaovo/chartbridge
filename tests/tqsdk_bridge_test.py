import importlib.util
import pathlib
import types
import unittest

path = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'tqsdk_bridge.py'
spec = importlib.util.spec_from_file_location('bridge', path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class Serial:
    def __init__(self, rows): self.rows = rows
    def to_dict(self, _orientation): return self.rows

class BridgeTests(unittest.TestCase):
    def test_quote_timestamp_uses_source_timezone_and_settlement(self):
        quote = types.SimpleNamespace(last_price=101, pre_settlement=100, datetime='2026-10-15 14:55:44.123456789', volume=5)
        record = bridge.quote_record(quote)
        self.assertEqual(record['timestamp'], 1792047344123)
        self.assertEqual(record['changePercent'], 1)
    def test_invalid_quotes_are_not_fabricated(self):
        self.assertIsNone(bridge.quote_record(types.SimpleNamespace(last_price=float('nan'), pre_settlement=100, datetime='', volume=5)))
        self.assertIsNone(bridge.source_timestamp('not a source date'))
    def test_nan_padding_is_removed_and_only_preceding_bars_are_closed(self):
        base = {'datetime': 1792047300000000000, 'open':100, 'high':105, 'low':99, 'close':101, 'volume':5}
        rows = [{**base, 'datetime':0}, base, {**base,'datetime':1792047360000000000}, {**base,'datetime':1792047420000000000}]
        output = bridge.candle_records(Serial(rows))
        self.assertEqual(len(output),3)
        self.assertEqual(output[0]['timestamp'],1792047300000)
        self.assertEqual([v['closed'] for v in output],[True,True,False])
        self.assertEqual(len(bridge.candle_records(Serial(rows),tail=True)),2)

if __name__ == '__main__': unittest.main()
