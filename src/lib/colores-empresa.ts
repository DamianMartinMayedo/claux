// Paleta de identificación de empresas. Nueve tonos separados en la rueda para
// distinguirlas de un vistazo en listas y documentos.
//
// Vive aquí porque la usan TRES sitios —la validación de `guardarEmpresa`, el
// selector de la ficha de empresa y el paso de puesta en marcha del dashboard— y
// hasta ahora estaba copiada en dos de ellos con una nota pidiendo que se
// mantuvieran sincronizados a mano. Si cambia, hay que mapear los tonos viejos en
// una migración (ver `075_paleta_colores_empresas.sql`).
export const COLORES_EMPRESA = [
  '#00AFAA', '#2563EB', '#7C3AED', '#C026D3',
  '#E11D48', '#EA580C', '#16A34A', '#64748B',
  '#FFBF00',
]
