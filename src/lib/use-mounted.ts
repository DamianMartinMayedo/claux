import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}

/**
 * Devuelve false durante el render del servidor y true ya en el cliente.
 * Reemplazo SSR-safe del patrón `const [mounted,setMounted]=useState(false);
 * useEffect(()=>setMounted(true),[])` que se repetía en ~10 modales y que el
 * React Compiler marca como setState-en-efecto. Útil para diferir createPortal.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}
