// Fixed upstream only: this endpoint cannot be used as an arbitrary URL proxy.
const SOURCE = 'https://mediaresults.toronto.ca/results/unofficialresult.json';
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
};
export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: HEADERS });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: HEADERS });
    try {
      const response = await fetch(SOURCE, {
        headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
        cf: { cacheTtl: 0 },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Upstream HTTP ' + response.status);
      const data = await response.json();
      if (!Array.isArray(data.office) || !data.office.some(office => office.name === 'Mayor')) {
        throw new Error('Invalid results feed');
      }
      data.fetchedAt = new Date().toISOString();
      data.sourceUpdatedAt = response.headers.get('last-modified');
      return Response.json(data, { headers: HEADERS });
    } catch (error) {
      return Response.json({ error: 'City results temporarily unavailable' }, { status: 502, headers: HEADERS });
    }
  },
};
