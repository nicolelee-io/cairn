import L from 'leaflet'

// leaflet.markercluster is a plain script that extends the global `L`, so the global has to exist
// before it runs. Import the cluster plugin through here, after this line (module order guarantees
// it), never directly.
;(globalThis as { L?: typeof L }).L = L
await import('leaflet.markercluster')

export default L
