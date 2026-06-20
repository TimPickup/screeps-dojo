import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { api } from '../../../api/client';
import styles from './EditTab.module.css';

interface FileEntry { path: string; kind: string; }

function normalizedJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s)); } catch { return s; }
}

function langFor(name: string): string {
  if (name.endsWith('.js')) return 'javascript';
  if (name.endsWith('.json')) return 'json';
  return 'plaintext';
}

function clientBoilerplateMap(room: string) {
  const rows: string[] = [];
  for (let y = 0; y < 50; y++) { let r = ''; for (let x = 0; x < 50; x++) r += (x === 0 || x === 49 || y === 0 || y === 49) ? '#' : '.'; rows.push(r); }
  return { room, terrain: rows, structures: [{ type: 'controller', x: 25, y: 25 }], flags: [] };
}
function newFileContent(name: string): string {
  if (/map.*\.json$/i.test(name)) { const m = name.match(/([WE]\d+[NS]\d+)/i); return JSON.stringify(clientBoilerplateMap(m ? m[1] : 'W1N1'), null, '\t'); }
  if (name.endsWith('.js')) return "'use strict';\n";
  if (name.endsWith('.json')) return '{}';
  return '';
}

export function EditTab({ scenario }: { scenario: string }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [mapDraft, setMapDraft] = useState('');
  const [mapView, setMapView] = useState<'visual' | 'json'>('visual');
  const [savedContent, setSavedContent] = useState('');
  const [status, setStatus] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [rooms, setRooms] = useState('');
  const [importLog, setImportLog] = useState<string[]>([]);
  const [token, setToken] = useState<{ needsActivation: boolean; maskedUrl?: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const loadingRef = useRef(false);

  const selectedKind = files.find((f) => f.path === selected)?.kind;
  const isMap = selectedKind === 'map';
  const current = isMap ? mapDraft : content;
  // maps: compare normalized JSON so the editor's re-serialized whitespace
  // doesn't show as "dirty" the instant the map loads.
  const dirty = isMap ? normalizedJson(current) !== normalizedJson(savedContent) : current !== savedContent;

  const refreshFiles = () => api.files(scenario).then(setFiles).catch(() => {});
  useEffect(() => { refreshFiles(); }, [scenario]);
  useEffect(() => { setMapView('visual'); }, [selected]);

  // auto-open scenario.js (or the first file) when nothing is selected yet —
  // direct fetch so it doesn't trip the unsaved-changes guard in open().
  useEffect(() => {
    if (selected || !files.length) return;
    const sc = files.find((f) => f.path === 'scenario.js') || files[0];
    api.file(scenario, sc.path).then(({ content: c }) => { setSelected(sc.path); setContent(c); setMapDraft(c); setSavedContent(c); }).catch(() => {});
  }, [files, selected, scenario]);

  // bridge with the embedded visual map editor (dojo-editor.html?embed=1)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!e.data) return;
      if (e.data.type === 'dojoEditorReady') {
        loadingRef.current = true; // the next change is the load echo, not an edit
        iframeRef.current?.contentWindow?.postMessage({ type: 'dojoLoadMap', map: savedContent }, '*');
      } else if (e.data.type === 'dojoMapChanged') {
        if (loadingRef.current) {
          // The editor re-serialises a loaded map into its own canonical form
          // (drops import-only fields, reorders keys). Rebaseline so simply
          // opening a map isn't reported as "unsaved changes".
          loadingRef.current = false;
          setSavedContent(e.data.map);
          setMapDraft(e.data.map);
        } else {
          setMapDraft(e.data.map);
        }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [savedContent]);

  const open = async (f: FileEntry) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    const { content: c } = await api.file(scenario, f.path);
    setSelected(f.path); setContent(c); setMapDraft(c); setSavedContent(c); setStatus('');
  };
  const save = async () => {
    if (!selected) return;
    await api.saveFile(scenario, selected, current);
    setSavedContent(current); setStatus('saved ✓');
    setTimeout(() => setStatus(''), 1500);
  };
  const removeFile = async (f: FileEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete ' + f.path + '?')) return;
    try { await api.deleteFile(scenario, f.path); if (selected === f.path) setSelected(null); refreshFiles(); }
    catch (err) { window.alert('Delete failed: ' + (err as Error).message); }
  };
  const renameFile = async (f: FileEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const to = (window.prompt('Rename "' + f.path + '" to:', f.path) || '').trim();
    if (!to || to === f.path || /[\\/]/.test(to)) return;
    try {
      await api.renameFile(scenario, f.path, to);
      if (selected === f.path) setSelected(to);
      refreshFiles();
    } catch (err) { window.alert('Rename failed: ' + (err as Error).message); }
  };
  const newFile = async () => {
    const nm = (window.prompt('New file name (e.g. helper.js or map.W1N1.json):') || '').trim();
    if (!nm || /[\\/]/.test(nm)) return;
    if (files.some((f) => f.path === nm)) { window.alert('That file already exists.'); return; }
    try {
      await api.saveFile(scenario, nm, newFileContent(nm));
      refreshFiles();
      const c = await api.file(scenario, nm);
      setSelected(nm); setContent(c.content); setMapDraft(c.content); setSavedContent(c.content);
    } catch (err) { window.alert('Create failed: ' + (err as Error).message); }
  };

  // Ctrl/Cmd-S to save
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [dirty, selected, current]);

  const runImport = async () => {
    const list = rooms.trim().split(/[\s,]+/).filter(Boolean);
    if (!list.length) return;
    const st = await api.tokenStatus().catch(() => null);
    if (st && st.needsActivation) { setToken(st); return; }
    setImporting(true); setImportLog([]);
    try {
      const { importId } = await api.importRooms(scenario, list);
      const es = new EventSource(api.importStreamUrl(importId));
      es.addEventListener('log', (e) => setImportLog((l) => l.concat(JSON.parse((e as MessageEvent).data).line)));
      es.addEventListener('done', () => { es.close(); setImporting(false); refreshFiles(); setImportLog((l) => l.concat('✓ done')); });
      es.addEventListener('failed', () => { es.close(); setImporting(false); setImportLog((l) => l.concat('✗ failed')); });
    } catch (e) { setImporting(false); setImportLog((l) => l.concat('error: ' + (e as Error).message)); }
  };

  return (
    <div className={styles.wrap}>
      <aside className={styles.tree}>
        <div className={styles.head}>files</div>
        {files.map((f) => (
          <div key={f.path} className={`${styles.row} ${selected === f.path ? styles.rowSel : ''}`} onClick={() => open(f)}>
            <span className={styles.fileName}>{f.path}</span>
            {f.kind === 'map' ? <span className={styles.tag}>map</span> : null}
            {f.path !== 'scenario.js' && (
              <button className={styles.del} title="Rename file" onClick={(e) => renameFile(f, e)}>✎</button>
            )}
            {f.path !== 'scenario.js' && (
              <button className={styles.del} title="Delete file" onClick={(e) => removeFile(f, e)}>✕</button>
            )}
          </div>
        ))}
        <button className={styles.newFile} onClick={newFile}>+ New file</button>
        <div className={styles.importBox}>
          <div className={styles.head}>⤓ Import room</div>
          <input className={styles.input} placeholder="W1N1 W2N1" value={rooms} onChange={(e) => setRooms(e.target.value)} />
          <button className={styles.importBtn} disabled={importing} onClick={runImport}>{importing ? 'importing…' : 'Import from live server'}</button>
          {importLog.length > 0 && <div className={styles.importLog}>{importLog.slice(-6).map((l, i) => <div key={i}>{l}</div>)}</div>}
        </div>
      </aside>

      <section className={styles.editor}>
        {!selected ? (
          <div className={styles.empty}>Select a file to edit. <code>.js</code>/<code>.json</code> open in the code editor; <code>map*.json</code> opens the visual map editor.</div>
        ) : (
          <>
            <div className={styles.toolbar}>
              <span className={styles.fname}>{selected}{dirty ? ' ●' : ''}</span>
              {isMap && (
                <span className={styles.viewToggle}>
                  <button
                    className={mapView === 'visual' ? styles.viewActive : styles.viewBtn}
                    onClick={() => { iframeRef.current?.contentWindow?.postMessage({ type: 'dojoLoadMap', map: mapDraft }, '*'); setMapView('visual'); }}
                  >Visual</button>
                  <button
                    className={mapView === 'json' ? styles.viewActive : styles.viewBtn}
                    onClick={() => { iframeRef.current?.contentWindow?.postMessage({ type: 'dojoLoadMap', map: mapDraft }, '*'); setMapView('json'); }}
                    title="Edit the raw map JSON"
                  >JSON</button>
                </span>
              )}
              <span className={styles.spacer} />
              <span className={styles.status}>{status}</span>
              <button className={styles.save} disabled={!dirty} onClick={save}>Save</button>
            </div>
            {isMap ? (
              <div className={styles.mapPane}>
                <iframe
                  key={selected}
                  ref={iframeRef}
                  className={styles.mapFrame}
                  style={{ display: mapView === 'visual' ? 'block' : 'none' }}
                  src="/dojo-editor.html?embed=1"
                  title="map editor"
                />
                {mapView === 'json' && (
                  <div className={styles.monaco}>
                    <Editor
                      height="100%"
                      theme="vs-dark"
                      language="json"
                      value={mapDraft}
                      onChange={(v) => setMapDraft(v ?? '')}
                      options={{ fontFamily: 'monospace', fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.monaco}>
                <Editor
                  height="100%"
                  theme="vs-dark"
                  language={langFor(selected)}
                  value={content}
                  onChange={(v) => setContent(v ?? '')}
                  options={{ fontFamily: 'monospace', fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false }}
                />
              </div>
            )}
          </>
        )}
      </section>

      {token && token.needsActivation && (
        <div className={styles.overlay} onClick={() => setToken(null)}>
          <div className={styles.popup} onClick={(e) => e.stopPropagation()}>
            <div className={styles.popupTitle}>⚠ Token needs activation</div>
            <p>Your auth token's 2-hour unlimited window is inactive. Open this while logged in to Screeps, then retry:</p>
            {token.maskedUrl && <code className={styles.url}>{token.maskedUrl}</code>}
            <div className={styles.popupBtns}>
              <button onClick={() => window.open(api.activateUrl, '_blank')}>Open in browser</button>
              <button onClick={async () => { const st = await api.tokenStatus().catch(() => null); if (st && !st.needsActivation) { setToken(null); runImport(); } else setToken(st); }}>Retry</button>
              <button onClick={() => setToken(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
