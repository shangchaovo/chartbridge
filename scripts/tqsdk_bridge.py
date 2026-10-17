"""Optional read-only TqSDK adapter. Credentials stay in the parent environment."""
import argparse
import contextlib
import datetime as dt
import importlib.util
import json
import math
import os
import signal
import sys
import time
from zoneinfo import ZoneInfo

INTERVALS = {'1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '1d': 86400}

def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None

def source_timestamp(value):
    try:
        stamp = dt.datetime.fromisoformat(str(value))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=ZoneInfo('Asia/Shanghai'))
        return int(stamp.timestamp() * 1000)
    except (ValueError, TypeError):
        return None

def quote_record(quote):
    price, previous = number(quote.last_price), number(quote.pre_settlement)
    timestamp = source_timestamp(quote.datetime)
    if price is None or timestamp is None:
        return None
    change = price - previous if previous is not None and previous > 0 else None
    return {'price': price, 'timestamp': timestamp, 'previousClose': previous, 'change': change,
            'changePercent': change / previous * 100 if change is not None else None, 'volume': number(quote.volume)}

def candle_records(serial, tail=False):
    rows = serial.to_dict('records')
    result = []
    for i, row in enumerate(rows):
        if tail and i < len(rows) - 2:
            continue
        nano = number(row.get('datetime'))
        values = {k: number(row.get(k)) for k in ['open', 'high', 'low', 'close', 'volume']}
        if nano is None or nano <= 0 or any(v is None for v in values.values()):
            continue
        result.append({'timestamp': int(row['datetime']) // 1_000_000, **values, 'closed': i < len(rows) - 1})
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    out = sys.stdout
    def emit(value):
        out.write(json.dumps(value, ensure_ascii=False, allow_nan=False) + '\n')
        out.flush()
    with open(args.config, encoding='utf-8') as file:
        config = json.load(file)
    user, password = os.environ.get(config['userEnv']), os.environ.get(config['passwordEnv'])
    if not user or not password:
        emit({'type': 'error', 'code': 'CREDENTIALS_MISSING'})
        return 2
    if importlib.util.find_spec('tqsdk') is None:
        emit({'type': 'error', 'code': 'SDK_NOT_INSTALLED'})
        return 2
    running = True
    def stop(_signal, _frame):
        nonlocal running
        running = False
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    api = None
    try:
        # SDK diagnostics never share the JSON data channel. Node discards stderr.
        with contextlib.redirect_stdout(sys.stderr):
            from tqsdk import TqApi, TqAuth, TqSim
            api = TqApi(TqSim(), auth=TqAuth(user, password), debug=False)
            quotes = {s: api.get_quote(s) for s in config['symbols']}
            serials = {(s, interval): api.get_kline_serial(s, INTERVALS[interval], data_length=config['historyLength'])
                       for s in config['symbols'] for interval in config['intervals']}
            sent = set()
            last_quotes = {}
            while running:
                if not api.wait_update(deadline=time.time() + 0.5):
                    continue
                for symbol, quote in quotes.items():
                    record = quote_record(quote)
                    if record and record != last_quotes.get(symbol):
                        emit({'type': 'quote', 'sourceSymbol': symbol, 'quote': record})
                        last_quotes[symbol] = record
                for key, serial in serials.items():
                    if not api.is_serial_ready(serial):
                        continue
                    if key not in sent or api.is_changing(serial):
                        rows = candle_records(serial, tail=key in sent)
                        if rows:
                            emit({'type': 'candles', 'sourceSymbol': key[0], 'interval': key[1], 'candles': rows})
                            sent.add(key)
    except Exception:
        emit({'type': 'error', 'code': 'CONNECTION_FAILED'})
        return 3
    finally:
        if api is not None:
            with contextlib.redirect_stdout(sys.stderr):
                api.close()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
