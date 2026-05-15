import React, { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';

const NAVY   = '#0a1628';
const ORANGE = '#E8622A';
const LIGHT  = '#f4f6fa';

const BUCKET = 'job-photos';

const TYPE_COLORS = {
  before: '#2980b9',
  after:  '#27ae60',
  other:  '#8899bb',
};

export default function JobPhotos({ invoiceId }) {
  const [photos, setPhotos]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState(null);
  const [fullsize, setFullsize]   = useState(null); // url string when modal open

  const [caption, setCaption] = useState('');
  const [type, setType]       = useState('other');

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
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setUploading(true);
    setError(null);

    const ext      = file.name.split('.').pop();
    const filename = `${Date.now()}.${ext}`;
    const path     = `${invoiceId}/${filename}`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { upsert: false });

    if (uploadErr) {
      setError('Upload failed: ' + uploadErr.message);
      setUploading(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(path);

    const { error: insertErr } = await supabase
      .from('job_photos')
      .insert({ invoice_id: invoiceId, url: publicUrl, caption: caption.trim() || null, type });

    if (insertErr) {
      setError('Photo saved to storage but DB insert failed: ' + insertErr.message);
    } else {
      setCaption('');
      await fetchPhotos();
    }
    setUploading(false);
  }

  async function handleDelete(photo) {
    if (!confirm('Delete this photo?')) return;

    // Derive storage path from the public URL
    const pathMatch = photo.url.match(/job-photos\/(.+)$/);
    if (pathMatch) {
      await supabase.storage.from(BUCKET).remove([pathMatch[1]]);
    }

    await supabase.from('job_photos').delete().eq('id', photo.id);
    setPhotos(ps => ps.filter(p => p.id !== photo.id));
  }

  return (
    <div style={{ padding: '0 0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, color: NAVY, letterSpacing: 1, textTransform: 'uppercase' }}>
          Job Photos {photos.length > 0 && <span style={{ color: '#aab1bf', fontWeight: 400 }}>({photos.length})</span>}
        </div>
      </div>

      {/* Upload controls */}
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
            width: '100%', padding: '9px 0', border: 'none', borderRadius: 8, cursor: uploading ? 'default' : 'pointer',
            background: uploading ? '#ccc' : ORANGE, color: '#fff',
            fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1,
          }}
        >
          {uploading ? 'Uploading…' : '+ Add Photo'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>

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
          {photos.map(photo => (
            <div key={photo.id} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: '#e4e8f0', aspectRatio: '1' }}>
              <img
                src={photo.url}
                alt={photo.caption || photo.type}
                onClick={() => setFullsize(photo.url)}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: 'pointer' }}
              />
              {/* Type badge */}
              <div style={{
                position: 'absolute', top: 5, left: 5,
                background: TYPE_COLORS[photo.type] + 'dd',
                color: '#fff', fontSize: 9, fontWeight: 700,
                letterSpacing: 1, padding: '2px 6px', borderRadius: 4,
                textTransform: 'uppercase', fontFamily: "'Barlow Condensed', sans-serif",
              }}>
                {photo.type}
              </div>
              {/* Delete button */}
              <button
                onClick={() => handleDelete(photo)}
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
          ))}
        </div>
      )}

      {/* Full-size modal */}
      {fullsize && (
        <div
          onClick={() => setFullsize(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <img
            src={fullsize}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, objectFit: 'contain' }}
          />
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
        </div>
      )}
    </div>
  );
}
