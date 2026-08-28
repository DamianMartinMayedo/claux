'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

/**
 * Campo de contraseña con su ojo de mostrar/ocultar.
 *
 * Existe para que haya UN solo ojo y siempre el mismo. Edge pinta el suyo dentro
 * del campo (`::-ms-reveal`), así que donde ya poníamos el nuestro salían dos —y
 * el del navegador solo destapa SU campo, de modo que en «repite la contraseña»
 * los dos acababan descoordinados—. Quien oculta el del navegador es la clase
 * `input-pwd` (en `03-components.css`), que este componente pone siempre: por eso
 * el ojo y el que lo tapa no pueden volver a separarse por olvidar una mitad.
 *
 * La clase base se pasa por `className` porque el sistema tiene dos: `form-input`
 * en las pantallas de acceso y `input` en los formularios del portal.
 */

type Props = Omit<React.ComponentProps<'input'>, 'type'>

export default function CampoPassword({ className = 'form-input', ...props }: Props) {
  const [ver, setVer] = useState(false)
  return (
    <div className="input-pwd-wrap">
      <input {...props} type={ver ? 'text' : 'password'} className={`${className} input-pwd`} />
      <button
        type="button"
        onClick={() => setVer(v => !v)}
        className="input-eye-btn"
        aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        {ver ? <EyeOff size={18} strokeWidth={2} /> : <Eye size={18} strokeWidth={2} />}
      </button>
    </div>
  )
}
