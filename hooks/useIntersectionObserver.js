import { useEffect, useRef, useState, useMemo } from 'react'

/**
 * Observes an element and fires once when it enters the viewport.
 * After triggering, the observer disconnects — suitable for
 * one-shot reveal animations.
 *
 * @param {{ threshold?: number, rootMargin?: string }} options
 * @returns {{ ref: React.RefObject, isVisible: boolean }}
 */
export function useIntersectionObserver({
  threshold  = 0.15,
  rootMargin = '0px',
} = {}) {
  const ref       = useRef(null)
  const [isVisible, setIsVisible] = useState(false)

  // Stable option object — avoids re-creating the observer on every render
  const options = useMemo(
    () => ({ threshold, rootMargin }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threshold, rootMargin],
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Already visible from a previous mount (e.g. HMR / StrictMode double-invoke)
    if (isVisible) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true)
        observer.disconnect()
      }
    }, options)

    observer.observe(el)
    return () => observer.disconnect()
    // `isVisible` intentionally omitted: we only want to re-observe if the
    // element ref or options change, not after we've already triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options])

  return { ref, isVisible }
}
