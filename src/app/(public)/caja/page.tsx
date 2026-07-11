import CajaApp from './CajaApp'

// Shell estático; todos los datos viven en IndexedDB del dispositivo y la
// sincronización va por /caja/api/*. El service worker lo cachea para offline.
export default function CajaPage() {
  return <CajaApp />
}
