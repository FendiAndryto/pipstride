(() => {
  const DATA_ROOT = '/replay/data/';
  const MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  const DAY_SECONDS = 86_400;
  const PARALLEL_REQUESTS = 6;
  let manifestRequest;

  async function request(file) {
    const response = await fetch(DATA_ROOT + file, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Gagal membaca data XAUUSD (${response.status}).`);
    return response;
  }

  function getManifest() {
    manifestRequest ??= request('manifest.json').then((response) => response.json()).catch((error) => {
      manifestRequest = undefined;
      throw error;
    });
    return manifestRequest;
  }

  function isoDate(seconds) {
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  }

  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return NaN;
    const seconds = Date.parse(`${value}T00:00:00Z`) / 1000;
    return Number.isFinite(seconds) && isoDate(seconds) === value ? seconds : NaN;
  }

  function monthLabel({ year, month }) {
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }

  async function getMonth(file) {
    const response = await request(file);
    const body = response.body.pipeThrough(new DecompressionStream('gzip'));
    return new Response(body).json();
  }

  async function getData(params) {
    const manifest = await getManifest();
    const timeframe = (params.get('timeframe') ?? 'M5').toUpperCase();
    const mode = params.get('period_mode') ?? 'month';
    const year = params.has('year') ? Number(params.get('year')) : null;
    const month = params.has('month') ? Number(params.get('month')) : null;
    const startDate = params.get('start_date');
    const endDate = params.get('end_date');
    const isDateRange = mode === 'custom' || mode === 'multi_month';
    const start = isDateRange ? parseDate(startDate) : -Infinity;
    const end = isDateRange ? parseDate(endDate) + DAY_SECONDS : Infinity;
    const available = manifest.months[timeframe];

    if (!Object.hasOwn(manifest.months, timeframe) || !manifest.coverage.period_modes.includes(mode)) {
      throw new Error('Timeframe atau mode periode tidak dikenal.');
    }
    if (isDateRange && !(start < end)) throw new Error('Rentang tanggal tidak valid.');

    const months = available.filter((entry) => {
      if (mode === 'month') return entry.year === year && entry.month === month;
      if (mode === 'year') return entry.year === year;
      if (isDateRange) return entry.startDate <= endDate && entry.endDate >= startDate;
      return true;
    });
    const rows = [];
    for (let offset = 0; offset < months.length; offset += PARALLEL_REQUESTS) {
      const batch = months.slice(offset, offset + PARALLEL_REQUESTS);
      const pages = await Promise.all(batch.map(({ file }) => getMonth(file)));
      for (const page of pages) {
        for (const candle of page) {
          if (candle.time >= start && candle.time < end) rows.push(candle);
        }
      }
    }
    // H1 files can share a boundary candle. Keep the later month's source row at each UTC time.
    rows.sort((left, right) => left.time - right.time);
    const candles = rows.filter((candle, index) => candle.time !== rows[index + 1]?.time);
    if (!candles.length) throw new Error(`Tidak ada candle ${timeframe} pada periode yang dipilih.`);

    const firstMonth = months[0];
    const lastMonth = months.at(-1);
    const first = candles[0].time;
    const last = candles.at(-1).time;
    const warning = months.find((entry) => entry.warning)?.warning;
    let label = monthLabel(firstMonth);
    if (mode === 'year') label = `Tahun ${year}`;
    else if (isDateRange) label = `${startDate} s/d ${endDate}`;
    else if (firstMonth !== lastMonth) label += ` - ${monthLabel(lastMonth)}`;

    return {
      meta: {
        symbol: 'XAUUSD',
        timeframe,
        period_mode: mode,
        year,
        month,
        requested_start_date: startDate,
        requested_end_date: endDate,
        period_label: label,
        start_date: isoDate(first),
        end_date: isoDate(last),
        total_bars: candles.length,
        first_bar_time: first,
        last_bar_time: last,
        months_loaded: months.length,
        warnings: warning ? [warning] : [],
      },
      candles,
    };
  }

  window.PipstrideReplayData = {
    getCoverage: async () => (await getManifest()).coverage,
    getData,
  };
})();
