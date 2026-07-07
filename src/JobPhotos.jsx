import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from './supabase.js';

const NAVY   = '#0a1628';
const ORANGE = '#E8622A';
const LIGHT  = '#f4f6fa';
const RED    = '#e74c3c';

const BUCKET = 'job-photos';

const TYPE_COLORS = {
  before: '#2980b9',
  after:  '#27ae60',
  other:  '#8899bb',
};

export async function fetchInvoicePhotos(invoiceId) {
  if (!invoiceId) return [];
  const { data, error } = await supabase
    .from('job_photos')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true });
  if (error) console.warn('[fetchInvoicePhotos]', error.message);
  return data || [];
}

export default function JobPhotos({ invoiceId }) {
  const [photos, setPhotos]                 = useState([]);
  const [loading, setLoading]               = useState(true);
  const [uploading, setUploading]           = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [error, setError]                   = useState(null);
  const [fullsize, setFullsize]             = useState(null);

  const [caption, setCaption] = useState('');
  const [type, setType]       = useState('other');

  // Batch selection
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected]     = useState(new Set());
  const [batchBusy, setBatchBusy]   = useState(false);

  const fileRef = useRef(null);

  useEffect(() => {
    if (!invoiceId) return;
    fetchPhotos();
  }, [invoiceId]);

  async function fetchPhotos() {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('job_photos')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('created_at', { ascending: true });
    if (err) {
      setError(err.message);
    } else {
      setPhotos(data || []);
    }
    setLoading(false);
  }

  async function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = '';

    setUploading(true);
    setError(null);
    setUploadProgress({ current: 0, total: files.length });

    for (let i = 0; i < files.length; i++) {
      setUploadProgress({ current: i + 1, total: files.length });
      const file     = files[i];
      const ext      = file.name.split('.').pop();
      const filename = `${Date.now()}_${i}.${ext}`;
      const path     = `${invoiceId}/${filename}`;

      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false });

      if (uploadErr) {
        setError(`Upload failed (${file.name}): ${uploadErr.message}`);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(path);

      const { error: insertErr } = await supabase
        .from('job_photos')
        .insert({ invoice_id: invoiceId, url: publicUrl, caption: caption.trim() || null, type });

      if (insertErr) {
        setError(`Saved to storage but DB insert failed (${file.name}): ${insertErr.message}`);
      }
    }

    setUploadProgress(null);
    setCaption('');
    await fetchPhotos();
    setUploading(false);
  }

  async function handleDelete(photo) {
    if (!confirm('Delete this photo?')) return;
    const pathMatch = photo.url.match(/job-photos\/(.+)$/);
    if (pathMatch) await supabase.storage.from(BUCKET).remove([pathMatch[1]]);
    await supabase.from('job_photos').delete().eq('id', photo.id);
    setPhotos(ps => ps.filter(p => p.id !== photo.id));
    if (fullsize?.id === photo.id) setFullsize(null);
  }

  async function handleRelabel(photo, newType) {
    await supabase.from('job_photos').update({ type: newType }).eq('id', photo.id);
    setPhotos(ps => ps.map(p => p.id === photo.id ? { ...p, type: newType } : p));
    setFullsize(f => f?.id === photo.id ? { ...f, type: newType } : f);
  }

  // --- Batch helpers ---
  function toggleSelect(photoId) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId); else next.add(photoId);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function selectAll() {
    setSelected(new Set(photos.map(p => p.id)));
  }

  async function handleBatchRelabel(newType) {
    setBatchBusy(true);
    const ids = [...selected];
    await Promise.all(ids.map(id =>
      supabase.from('job_photos').update({ type: newType }).eq('id', id)
    ));
    setPhotos(ps => ps.map(p => selected.has(p.id) ? { ...p, type: newType } : p));
    exitSelectMode();
    setBatchBusy(false);
  }

  async function handleBatchDelete() {
    const n = selected.size;
    if (!confirm(`Delete ${n} photo${n > 1 ? 's' : ''}?`)) return;
    setBatchBusy(true);
    const ids = [...selected];
    const storagePaths = photos
      .filter(p => selected.has(p.id))
      .map(p => { const m = p.url.match(/job-photos\/(.+)$/); return m ? m[1] : null; })
      .filter(Boolean);
    if (storagePaths.length) await supabase.storage.from(BUCKET).remove(storagePaths);
    await supabase.from('job_photos').delete().in('id', ids);
    setPhotos(ps => ps.filter(p => !selected.has(p.id)));
    exitSelectMode();
    setBatchBusy(false);
  }

  const uploadLabel = uploading
    ? (uploadProgress && uploadProgress.total > 1
        ? `Uploading ${uploadProgress.current} / ${uploadProgress.total}…`
        : 'Uploading…')
    : '+ Add Photos';

  const allSelected = photos.length > 0 && selected.size === photos.length;

  return (
    <div style={{ padding: '0 0 80px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: NAVY, letterSpacing: 1, textTransform: 'uppercase' }}>
          Job Photos {photos.length > 0 && <span style={{ color: '#aab1bf', fontWeight: 400 }}>({photos.length})</span>}
        </div>
        {photos.length > 0 && !selectMode && (
          <button
            onClick={() => setSelectMode(true)}
            style={{
              background: 'none', border: '1.5px solid #dde2ee', borderRadius: 7,
              padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
              fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1,
              textTransform: 'uppercase', color: '#6677aa',
            }}
          >
            Select
          </button>
        )}
        {selectMode && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={allSelected ? () => setSelected(new Set()) : selectAll}
              style={{
                background: 'none', border: '1.5px solid #dde2ee', borderRadius: 7,
                padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1,
                textTransform: 'uppercase', color: '#6677aa',
              }}
            >
              {allSelected ? 'None' : 'All'}
            </button>
            <button
              onClick={exitSelectMode}
              style={{
                background: 'none', border: '1.5px solid #dde2ee', borderRadius: 7,
                padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: 1,
                textTransform: 'uppercase', color: '#6677aa',
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Upload controls — hidden in select mode */}
      {!selectMode && (
        <div style={{ background: LIGHT, borderRadius: 10, padding: 12, marginBottom: 14, border: '1.5px solid #dde2ee' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {['before', 'after', 'other'].map(t => (
              <button
                key={t}
                onClick={() => setType(t)}
                style={{
                  flex: 1, padding: '7px 4px', border: 'none', borderRadius: 7, cursor: 'pointer',
                  fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12,
                  letterSpacing: 1, textTransform: 'uppercase',
                  background: type === t ? TYPE_COLORS[t] : '#e4e8f0',
                  color: type === t ? '#fff' : '#6677aa',
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            value={caption}
            onChange={e => setCaption(e.target.value)}
            placeholder="Caption (optional)"
            style={{
              width: '100%', border: '1.5px solid #dde2ee', borderRadius: 8,
              padding: '8px 10px', fontSize: 13, fontFamily: "'Barlow', sans-serif",
              background: '#fff', boxSizing: 'border-box', outline: 'none', marginBottom: 8,
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              width: '100%', padding: '9px 0', border: 'none', borderRadius: 8,
              cursor: uploading ? 'default' : 'pointer',
              background: uploading ? '#ccc' : ORANGE, color: '#fff',
              fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1,
            }}
          >
            {uploadLabel}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />
        </div>
      )}

      {error && (
        <div style={{ background: '#fde2e1', color: '#8a1f1c', borderRadius: 7, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', color: '#aab1bf', fontSize: 13, padding: 16 }}>Loading…</div>
      )}

      {!loading && photos.length === 0 && (
        <div style={{ textAlign: 'center', color: '#aab1bf', fontSize: 13, padding: 20 }}>No photos yet</div>
      )}

      {/* Photo grid */}
      {photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {photos.map(photo => {
            const isSelected = selected.has(photo.id);
            return (
              <div
                key={photo.id}
                onClick={() => selectMode ? toggleSelect(photo.id) : setFullsize(photo)}
                style={{
                  position: 'relative', borderRadius: 8, overflow: 'hidden',
                  background: '#e4e8f0', aspectRatio: '1', cursor: 'pointer',
                  outline: isSelected ? `3px solid ${ORANGE}` : 'none',
                  outlineOffset: -3,
                }}
              >
                <img
                  src={photo.url}
                  alt={photo.caption || photo.type}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />

                {/* Select mode: checkbox overlay */}
                {selectMode && (
                  <div style={{
                    position: 'absolute', top: 5, left: 5,
                    width: 22, height: 22, borderRadius: '50%',
                    border: `2px solid ${isSelected ? ORANGE : 'rgba(255,255,255,0.85)'}`,
                    background: isSelected ? ORANGE : 'rgba(0,0,0,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                )}

                {/* Normal mode: type badge */}
                {!selectMode && (
                  <div style={{
                    position: 'absolute', top: 5, left: 5,
                    background: TYPE_COLORS[photo.type] + 'dd',
                    color: '#fff', fontSize: 9, fontWeight: 700,
                    letterSpacing: 1, padding: '2px 6px', borderRadius: 4,
                    textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif",
                  }}>
                    {photo.type}
                  </div>
                )}

                {/* Normal mode: delete button */}
                {!selectMode && (
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(photo); }}
                    style={{
                      position: 'absolute', top: 4, right: 4,
                      width: 22, height: 22, borderRadius: '50%',
                      background: 'rgba(0,0,0,0.55)', color: '#fff',
                      border: 'none', cursor: 'pointer', fontSize: 13,
                      lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    ×
                  </button>
                )}

                {/* Caption */}
                {photo.caption && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: 'rgba(10,22,40,0.72)', color: '#fff',
                    fontSize: 10, padding: '3px 6px',
                    fontFamily: "'Barlow', sans-serif", lineHeight: 1.3,
                  }}>
                    {photo.caption}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Batch action bar — portal so it always sits at bottom of screen */}
      {selectMode && createPortal(
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9998,
          background: NAVY, padding: '10px 12px 10px',
          boxShadow: '0 -2px 12px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13,
            color: selected.size > 0 ? '#fff' : '#8899bb', letterSpacing: 1, textAlign: 'center',
          }}>
            {selected.size > 0 ? `${selected.size} selected` : 'Tap photos to select'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['before', 'after', 'other'].map(t => (
              <button
                key={t}
                disabled={selected.size === 0 || batchBusy}
                onClick={() => handleBatchRelabel(t)}
                style={{
                  flex: 1, padding: '9px 4px', border: 'none', borderRadius: 8,
                  fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12,
                  letterSpacing: 1, textTransform: 'uppercase',
                  background: selected.size > 0 && !batchBusy ? TYPE_COLORS[t] : '#2a3a52',
                  color: selected.size > 0 && !batchBusy ? '#fff' : '#4a5a72',
                  cursor: selected.size > 0 && !batchBusy ? 'pointer' : 'default',
                }}
              >
                {t}
              </button>
            ))}
            <button
              disabled={selected.size === 0 || batchBusy}
              onClick={handleBatchDelete}
              style={{
                flex: 1, padding: '9px 4px', border: 'none', borderRadius: 8,
                fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 12,
                letterSpacing: 1, textTransform: 'uppercase',
                background: selected.size > 0 && !batchBusy ? RED : '#2a3a52',
                color: selected.size > 0 && !batchBusy ? '#fff' : '#4a5a72',
                cursor: selected.size > 0 && !batchBusy ? 'pointer' : 'default',
              }}
            >
              Delete
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Full-size modal with type editor — portal bypasses tab transform clipping */}
      {fullsize && createPortal(
        <div
          onClick={() => setFullsize(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
            zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}
          >
            <img
              src={fullsize.url}
              alt=""
              style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 8, objectFit: 'contain' }}
            />
            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
              {['before', 'after', 'other'].map(t => (
                <button
                  key={t}
                  onClick={() => handleRelabel(fullsize, t)}
                  style={{
                    flex: 1, padding: '10px 4px', border: 'none', borderRadius: 8, cursor: 'pointer',
                    fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 13,
                    letterSpacing: 1, textTransform: 'uppercase',
                    background: fullsize.type === t ? TYPE_COLORS[t] : 'rgba(255,255,255,0.15)',
                    color: '#fff',
                    outline: fullsize.type === t ? `2px solid ${TYPE_COLORS[t]}` : 'none',
                    outlineOffset: 2,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
            {fullsize.caption && (
              <div style={{ color: '#ccd', fontSize: 13, fontFamily: "'Barlow', sans-serif", textAlign: 'center' }}>
                {fullsize.caption}
              </div>
            )}
          </div>
          <button
            onClick={() => setFullsize(null)}
            style={{
              position: 'absolute', top: 16, right: 16,
              width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', color: '#fff',
              border: 'none', cursor: 'pointer', fontSize: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
