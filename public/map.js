// Farm map prototype: OpenStreetMap tiles with Leaflet, and boundaries drawn by hand.
// Boundaries are kept in this browser only (localStorage). Saving them to the account is the next step.
/* global L */
const IDAHO_FALLS = [43.4917, -112.0339];
const SQ_METERS_PER_ACRE = 4046.8564224;
const STORAGE_KEY = 'cattletrackers.map.boundaries';

const statusEl = document.getElementById('map-status');
const clearBtn = document.getElementById('clear-btn');
const locateBtn = document.getElementById('locate-btn');

const setStatus = (text, isError = false) => {
  statusEl.textContent = text;
  statusEl.classList.toggle('text-danger', isError);
  statusEl.classList.toggle('text-muted', !isError);
};

const map = L.map('map').setView(IDAHO_FALLS, 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const drawn = new L.FeatureGroup().addTo(map);
map.addControl(new L.Control.Draw({
  edit: { featureGroup: drawn },
  draw: { polygon: { allowIntersection: false, shapeOptions: { color: '#198754' } }, polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false },
}));

function totalAcres() {
  const sqMeters = drawn.getLayers().reduce((sum, layer) => sum + L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]), 0);
  return sqMeters / SQ_METERS_PER_ACRE;
}

function refresh() {
  const count = drawn.getLayers().length;
  clearBtn.disabled = count === 0;
  if (!count) return setStatus('No boundaries yet. Use the polygon tool to draw one.');
  setStatus(`${count} boundar${count === 1 ? 'y' : 'ies'}, about ${totalAcres().toFixed(1)} acres in total. Drawn by hand, so approximate and not a legal survey. Saved in this browser only.`);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drawn.toGeoJSON()));
  } catch {
    setStatus('Could not save in this browser (storage is full or blocked).', true);
    return;
  }
  refresh();
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.type === 'FeatureCollection') {
      L.geoJSON(saved).eachLayer((layer) => {
        if (layer instanceof L.Polygon) drawn.addLayer(layer);
      });
    }
  } catch {
    setStatus('The saved boundaries could not be read, so they were skipped.', true);
    return;
  }
  if (drawn.getLayers().length) map.fitBounds(drawn.getBounds(), { padding: [20, 20] });
  refresh();
}

map.on(L.Draw.Event.CREATED, (e) => {
  drawn.addLayer(e.layer);
  persist();
});
map.on(L.Draw.Event.EDITED, persist);
map.on(L.Draw.Event.DELETED, persist);

clearBtn.addEventListener('click', () => {
  if (!window.confirm('Remove every boundary you drew?')) return;
  drawn.clearLayers();
  persist();
});

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) return setStatus('This browser cannot share your location.', true);
  navigator.geolocation.getCurrentPosition(
    (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 16),
    () => setStatus('Could not get your location. Check the browser permission.', true)
  );
});

restore();
