require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.TFNSW_API_KEY;

if (!API_KEY) {
  console.error('Missing TFNSW_API_KEY. Create a .env file (see .env.example).');
  process.exit(1);
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/departures', async (req, res) => {
  const now = new Date();
  const dateStr = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const timeStr = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');

  const params = new URLSearchParams({
    outputFormat: 'rapidJSON',
    coordOutputFormat: 'EPSG:4326',
    mode: 'direct',
    type_dm: 'stop',
    name_dm: '210143',
    depArrMacro: 'dep',
    TfNSWDM: 'true',
    itdDate: dateStr,
    itdTime: timeStr,
  });

  const url = `https://api.transport.nsw.gov.au/v1/tp/departure_mon?${params}`;

  try {
    const apiRes = await fetch(url, {
      headers: { Authorization: `apikey ${API_KEY}` },
    });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      console.error(`TfNSW API error ${apiRes.status}: ${text}`);
      return res.status(apiRes.status).json({ error: 'TfNSW API error', status: apiRes.status });
    }

    const data = await apiRes.json();
    const events = data.stopEvents || [];

    const departures = events
      .filter((e) => {
        const num = e.transportation?.number?.toUpperCase() || '';
        return num === 'B1';
      })
      .map((e) => {
        const planned = e.departureTimePlanned;
        const estimated = e.departureTimeEstimated || planned;
        const route = e.transportation?.number || '';
        const destination = e.transportation?.destination?.name || '';
        const isRealtime = !!e.departureTimeEstimated;

        const plannedDate = new Date(planned);
        const estimatedDate = new Date(estimated);
        const diffMs = estimatedDate - plannedDate;
        const diffMin = Math.round(diffMs / 60000);

        let status;
        if (!isRealtime) status = 'Scheduled';
        else if (diffMin === 0) status = 'On time';
        else if (diffMin > 0) status = `${diffMin} min late`;
        else status = `${Math.abs(diffMin)} min early`;

        const minsAway = Math.max(0, Math.round((estimatedDate - now) / 60000));

        return {
          route,
          destination,
          scheduledTime: planned,
          estimatedTime: estimated,
          status,
          isRealtime,
          diffMin,
          minsAway,
        };
      })
      .sort((a, b) => new Date(a.estimatedTime) - new Date(b.estimatedTime));

    res.json({ departures, updatedAt: now.toISOString() });
  } catch (err) {
    console.error('Fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch departures' });
  }
});

app.listen(PORT, () => {
  console.log(`B-Line departure board running at http://localhost:${PORT}`);
});
