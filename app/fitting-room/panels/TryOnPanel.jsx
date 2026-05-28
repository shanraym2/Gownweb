'use client'

/**
 * app/fitting-room/panels/TryOnPanel.jsx
 *
 * No functional changes required — TryOnPanel was already correct.
 * It passes onSave={saveTryon} which TryOnCamera now properly accepts and calls.
 *
 * The only cosmetic fix: saveMsg display moved inside the layout div so it
 * sits flush under the camera rather than floating outside the panel.
 */

import { useCallback, useEffect, useState } from 'react'
import { useFittingRoom } from '../FittingRoomProvider'
import TryOnCamera from '../../components/TryOnCamera'
import { getCurrentUser } from '../../utils/authClient'

export default function TryOnPanel({ initialGownId }) {
  const { gowns, detectorRef, segmenterRef, modelState } = useFittingRoom()
  const [selectedGown, setSelectedGown] = useState(null)
  const [saving,       setSaving      ] = useState(false)
  const [saveMsg,      setSaveMsg     ] = useState('')

  useEffect(() => {
    if (!gowns.length) return
    const chosen = (initialGownId ? gowns.find(g => String(g.id) === String(initialGownId)) : null) || gowns[0]
    setSelectedGown(chosen)
  }, [gowns, initialGownId])

  // Clear save message when gown changes so stale "Saved" doesn't linger
  useEffect(() => { setSaveMsg('') }, [selectedGown])

  const saveTryon = useCallback(async (imageDataUrl) => {
    const user = getCurrentUser()
    if (!user) { setSaveMsg('Sign in to save your try-on.'); return }
    setSaving(true); setSaveMsg('')
    try {
      const res = await fetch('/api/auth/save-tryon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({
          image:    imageDataUrl,
          gownId:   selectedGown?.id,
          gownName: selectedGown?.name || '',
        }),
      })
      const d = await res.json()
      setSaveMsg(d.ok ? '✓ Saved to your profile' : (d.error || 'Save failed'))
    } catch {
      setSaveMsg('Could not save. Check connection.')
    } finally {
      setSaving(false)
    }
  }, [selectedGown])

  return (
    <div className="fr-tryon-layout">
      <TryOnCamera
        gown={selectedGown}
        gowns={gowns}
        onGownChange={setSelectedGown}
        externalDetector={detectorRef}
        externalSegmenter={segmenterRef}
        modelState={modelState}
        onSave={saveTryon}
      />
      {saveMsg && (
        <p className={`fr-save-msg${saveMsg.startsWith('✓') ? ' ok' : ' err'}`}
          style={{ padding: '4px 12px', fontSize: '12px', margin: 0 }}>
          {saveMsg}
        </p>
      )}
      {saving && (
        <p style={{ padding: '4px 12px', fontSize: '12px', margin: 0, color: '#888' }}>
          Saving…
        </p>
      )}
    </div>
  )
}