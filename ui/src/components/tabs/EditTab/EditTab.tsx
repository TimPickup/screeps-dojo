import { useEffect, useRef, useState } from 'react';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import { api } from '../../../api/client';
import { CanvasMapEditor, type CanvasMapEditorChangeKind } from '../../CanvasMapEditor/CanvasMapEditor';
import { MAIN_SIDE, parseDoc } from '../../ScenarioSettingsEditor/settingsDoc';
import { ScenarioSettingsEditor } from '../../ScenarioSettingsEditor/ScenarioSettingsEditor';
import { UnsavedDialog } from './UnsavedDialog';
import { clearNavigationGuard, setNavigationGuard, type NavigationGuard } from '../../../state/navigationGuard';
import { configureJavaScript, jsSideFor, selectJsTypes, stripAnnotation, wantsScenarioAnnotation, withAnnotation } from './editorTypes';
import styles from './EditTab.module.css';

interface FileEntry { path: string; kind: string; }

function normalizedJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s)); } catch { return s; }
}

// Deep key-sorted stringify that also prunes "empty" values (null, [], {}) so
// two maps that differ only in key order, whitespace, or the empty-vs-absent
// distinction (the editor emits `flags: []`; an imported map omits the key
// entirely) compare equal — while a genuine content change (e.g. the editor
// generating source/mineral ids, or migrating sources to the top-level array)
// still does not. Used only to decide whether opening a map is a real repair.
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      const cv = canonicalize(src[k]);
      if (cv === null || cv === undefined) continue;
      if (Array.isArray(cv) && cv.length === 0) continue;
      if (typeof cv === 'object' && !Array.isArray(cv) && Object.keys(cv).length === 0) continue;
      out[k] = cv;
    }
    return out;
  }
  return v;
}
function canonicalJson(s: string): string {
  try { return JSON.stringify(canonicalize(JSON.parse(s))); } catch { return s; }
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

export function EditTab({ scenario, initialFile }: { scenario: string; initialFile?: string }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [mapDraft, setMapDraft] = useState('');
  const [settingsDraft, setSettingsDraft] = useState('');
  const [view, setView] = useState<'visual' | 'json'>('visual');
  const [savedContent, setSavedContent] = useState('');
  const [status, setStatus] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [rooms, setRooms] = useState('');
  const [importCreeps, setImportCreeps] = useState(true);
  const [importStructures, setImportStructures] = useState(true);
  const [importMemory, setImportMemory] = useState(false);
  const [importSegments, setImportSegments] = useState(false);
  const [overwriteMaps, setOverwriteMaps] = useState(true);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [token, setToken] = useState<{ needsActivation: boolean; maskedUrl?: string } | null>(null);
  // Which curated game mods this scenario selects. The map editor offers their
  // objects (a Season 5 reactor) only where a run would understand one. Read
  // from the settings draft while it is being edited, so ticking Season 5 in
  // the ⚙ makes the reactor appear without a save.
  const [savedMods, setSavedMods] = useState<string[]>([]);
  // The player SIDES this scenario declares (settings.json "bots"). They are
  // the owner labels a map may legally use, so the editor's owner dropdown can
  // offer exactly the ones this scenario could actually run a codebase for.
  const [savedSides, setSavedSides] = useState<string[]>([]);
  // What to do once the unsaved-changes prompt is answered. Non-null means
  // the prompt is on screen.
  const [pendingLeave, setPendingLeave] = useState<{ proceed: () => void } | null>(null);
  const jumpingRef = useRef(false);
  // The guard below is registered once but must read today's values, not the
  // ones captured when it was created.
  const dirtyRef = useRef(false);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  // Whether this file gets the editor-only type annotation (see
  // withAnnotation), decided when it is opened.
  const [annotate, setAnnotate] = useState(false);
  const annotatedLineRef = useRef(0);

  const selectedKind = files.find((f) => f.path === selected)?.kind;
  const isMap = selectedKind === 'map';
  const isSettings = selectedKind === 'settings';
  const structured = isMap || isSettings;
  const current = isMap ? mapDraft : isSettings ? settingsDraft : content;
  // maps and settings: compare normalized JSON so the editor's re-serialized
  // whitespace doesn't show as "dirty" the instant the file loads.
  const dirty = structured ? normalizedJson(current) !== normalizedJson(savedContent) : current !== savedContent;

  dirtyRef.current = dirty;

  // Bot code and scenario code run in different places, so each .js file gets
  // only its own runtime's completions (see editorTypes.ts).
  const jsSide = selected && selected.endsWith('.js') ? jsSideFor(selected, content) : null;
  useEffect(() => {
    if (monacoRef.current && jsSide) selectJsTypes(monacoRef.current, jsSide);
  }, [jsSide]);
  const beforeMount = (monaco: Monaco) => {
    monacoRef.current = monaco;
    configureJavaScript(monaco);
    if (jsSide) selectJsTypes(monaco, jsSide);
  };
  const annotated = annotate ? withAnnotation(content) : { value: content, line: 0 };
  annotatedLineRef.current = annotated.line;
  // Hide the annotation line and number the rest as the file does, so line
  // numbers still match the ones in run errors.
  const applyAnnotationView = () => {
    const editor = editorRef.current, monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const line = annotatedLineRef.current;
    (editor as any).setHiddenAreas(line ? [new monaco.Range(line, 1, line, 1)] : []);
    editor.updateOptions({
      lineNumbers: line ? (n: number) => String(n > annotatedLineRef.current && annotatedLineRef.current ? n - 1 : n) : 'on'
    });
  };
  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    applyAnnotationView();
    // never leave the caret on the hidden line, where typing would edit it
    editor.onDidChangeCursorPosition((e) => {
      const line = annotatedLineRef.current;
      if (line && e.position.lineNumber === line) editor.setPosition({ lineNumber: line + 1, column: 1 });
    });
  };
  useEffect(applyAnnotationView, [annotated.line, selected]);

  // Anything that navigates away — the tab strip, the breadcrumbs, the back
  // button — asks here first, so a draft that only lives in React state is
  // never thrown away silently.
  useEffect(() => {
    const guard: NavigationGuard = (proceed) => {
      if (!dirtyRef.current) { proceed(); return; }
      setPendingLeave({ proceed });
    };
    setNavigationGuard(guard);
    return () => clearNavigationGuard(guard);
  }, []);

  // Closing or reloading the browser is outside React's reach, so it gets
  // the browser's own generic prompt.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const refreshFiles = () => api.files(scenario).then(setFiles).catch(() => {});
  useEffect(() => { refreshFiles(); }, [scenario]);
  useEffect(() => {
    let live = true;
    api.scenarioSettings(scenario)
      .then((r) => {
        if (!live) return;
        setSavedMods(r.settings?.mods || []);
        // Offer the last import's rooms again (settings.json "lastImport").
        setRooms(r.settings?.lastImport || '');
        const bots = r.settings?.bots;
        setSavedSides(bots && typeof bots === 'object' ? Object.keys(bots).filter((side) => side !== 'main') : []);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [scenario]);
  const scenarioMods = isSettings ? (parseDoc(settingsDraft).form?.mods ?? savedMods) : savedMods;
  const scenarioSides = isSettings
    ? (parseDoc(settingsDraft).form?.sides.map((s) => s.side).filter((side) => side !== MAIN_SIDE) ?? savedSides)
    : savedSides;
  useEffect(() => { setView('visual'); }, [selected]);

  const load = (path: string, text: string) => {
    setSelected(path); setContent(text); setMapDraft(text); setSettingsDraft(text); setSavedContent(text);
    setAnnotate(wantsScenarioAnnotation(path, text));
  };

  // auto-open scenario.js (or the first file) when nothing is selected yet —
  // direct fetch so it doesn't trip the unsaved-changes guard in open().
  useEffect(() => {
    if (selected || !files.length || jumpingRef.current) return;
    const sc = files.find((f) => f.path === 'scenario.js') || files[0];
    api.file(scenario, sc.path).then(({ content: c }) => load(sc.path, c)).catch(() => {});
  }, [files, selected, scenario]);

  // The workspace's cog asks for a file by name; it may not exist yet, so probe
  // by reading rather than by looking in `files`, which can still be empty here
  // and would make us clobber a real settings.json with an empty one.
  useEffect(() => {
    if (!initialFile) return;
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    jumpingRef.current = true;
    (async () => {
      const path = initialFile;
      try {
        let text: string;
        try {
          text = (await api.file(scenario, path)).content;
        } catch {
          text = newFileContent(path);
          await api.saveFile(scenario, path, text);
          refreshFiles();
        }
        load(path, text); setStatus('');
      } catch (e) { window.alert('Could not open ' + path + ': ' + (e as Error).message); }
      jumpingRef.current = false;
    })();
  }, [initialFile, scenario]);

  const onMapEditorChange = (next: string, kind: CanvasMapEditorChangeKind) => {
    setMapDraft(next);
    // Loading canonicalizes harmless key order/empty values, while generated
    // source/mineral ids remain a genuine repair that should be saved.
    if (kind === 'load' && canonicalJson(next) === canonicalJson(savedContent)) setSavedContent(next);
  };

  const open = async (f: FileEntry) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    const { content: c } = await api.file(scenario, f.path);
    load(f.path, c); setStatus('');
  };
  const save = async () => {
    if (!selected) return;
    await api.saveFile(scenario, selected, current);
    setSavedContent(current); setStatus('saved ✓');
    setTimeout(() => setStatus(''), 1500);
  };
  saveRef.current = save;
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
      load(nm, c.content);
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

  // Re-reads the open file from disk. Used after an import, which can rewrite
  // the very file being edited.
  const reloadOpenFile = async () => {
    const path = selected;
    if (!path) return;
    let text: string;
    try { text = (await api.file(scenario, path)).content; }
    catch { return; }            // deleted by the import: leave the draft alone
    if (normalizedJson(text) === normalizedJson(savedContent)) return;   // unchanged on disk
    if (dirtyRef.current && !window.confirm(
      'The import rewrote ' + path + ', which you have unsaved changes to. '
      + 'Reload it and lose your changes?')) return;
    load(path, text);
    setStatus('reloaded after import');
    setTimeout(() => setStatus(''), 2500);
  };

  const runImport = async () => {
    const list = rooms.trim().split(/[\s,]+/).filter(Boolean);
    if (!list.length) return;
    const st = await api.tokenStatus(scenario).catch(() => null);
    if (st && st.needsActivation) { setToken(st); return; }
    setImporting(true); setImportLog([]);
    try {
      const { importId } = await api.importRooms(scenario, list, {
        creeps: importCreeps, structures: importStructures,
        memory: importMemory, segments: importSegments, overwrite: overwriteMaps
      });
      const es = new EventSource(api.importStreamUrl(importId));
      es.addEventListener('log', (e) => setImportLog((l) => l.concat(JSON.parse((e as MessageEvent).data).line)));
      es.addEventListener('done', () => {
        es.close(); setImporting(false); refreshFiles();
        setImportLog((l) => l.concat('✓ done'));
        // The open file may be one the import just rewrote. Re-read it, or
        // you carry on editing the copy from before the import and save it
        // back over the fresh one.
        reloadOpenFile();
      });
      es.addEventListener('failed', () => { es.close(); setImporting(false); setImportLog((l) => l.concat('✗ failed')); });
    } catch (e) { setImporting(false); setImportLog((l) => l.concat('error: ' + (e as Error).message)); }
  };

  const answerLeave = async (action: 'save' | 'discard' | 'cancel') => {
    const pending = pendingLeave;
    setPendingLeave(null);
    if (!pending || action === 'cancel') return;
    if (action === 'save') {
      try { await saveRef.current(); }
      catch (e) { window.alert('Save failed, so nothing was discarded: ' + (e as Error).message); return; }
    }
    dirtyRef.current = false;
    pending.proceed();
  };

  return (
    <div className={styles.wrap}>
      {pendingLeave && (
        <UnsavedDialog file={selected || 'this file'}
          onSave={() => answerLeave('save')}
          onDiscard={() => answerLeave('discard')}
          onCancel={() => answerLeave('cancel')} />
      )}
      <aside className={styles.tree}>
        <div className={styles.head}>files</div>
        {files.map((f) => (
          <div key={f.path} className={`${styles.row} ${selected === f.path ? styles.rowSel : ''}`} onClick={() => open(f)}>
            <span className={styles.fileName}>{f.path}</span>
            {f.kind === 'map' || f.kind === 'settings' ? <span className={styles.tag}>{f.kind}</span> : null}
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
          <input className={styles.input} placeholder="W1N1 W2N1 or W7N4:W6N2" value={rooms} onChange={(e) => setRooms(e.target.value)} />
          <div className={styles.importOptions}>
            <label><input type="checkbox" checked={importCreeps} onChange={(e) => setImportCreeps(e.target.checked)} /> My creeps</label>
            <label><input type="checkbox" checked={importStructures} onChange={(e) => setImportStructures(e.target.checked)} /> My structures</label>
            <label><input type="checkbox" checked={importMemory} onChange={(e) => setImportMemory(e.target.checked)} /> Memory</label>
            <label><input type="checkbox" checked={importSegments} onChange={(e) => setImportSegments(e.target.checked)} /> Memory segments</label>
            <label><input type="checkbox" checked={overwriteMaps} onChange={(e) => setOverwriteMaps(e.target.checked)} /> Overwrite existing maps</label>
          </div>
          <button className={styles.importBtn} disabled={importing} onClick={runImport}>{importing ? 'importing…' : 'Import from live server'}</button>
          {importLog.length > 0 && <div className={styles.importLog}>{importLog.slice(-6).map((l, i) => <div key={i}>{l}</div>)}</div>}
        </div>
      </aside>

      <section className={styles.editor}>
        {!selected ? (
          <div className={styles.empty}>Select a file to edit. <code>.js</code>/<code>.json</code> open in the code editor; <code>map*.json</code> opens the visual map editor; <code>settings.json</code> opens the bot/server profile form.</div>
        ) : (
          <>
            <div className={styles.toolbar}>
              <span className={styles.fname}>
                {selected}
                {isSettings && <span className={styles.fnameNote}>(Scenario Overrides)</span>}
                {dirty ? ' ●' : ''}
              </span>
              {structured && (
                <span className={styles.viewToggle}>
                  <button
                    className={view === 'visual' ? styles.viewActive : styles.viewBtn}
                    onClick={() => setView('visual')}
                  >{isSettings ? 'Form' : 'Visual'}</button>
                  <button
                    className={view === 'json' ? styles.viewActive : styles.viewBtn}
                    onClick={() => setView('json')}
                    title={isSettings ? 'Edit the raw settings JSON' : 'Edit the raw map JSON'}
                  >JSON</button>
                </span>
              )}
              <span className={styles.spacer} />
              <span className={styles.status}>{status}</span>
              <button className={styles.save} disabled={!dirty} onClick={save}>Save</button>
            </div>
            {structured ? (
              <div className={styles.pane}>
                {view === 'visual' ? (
                  isSettings ? (
                    <ScenarioSettingsEditor key={selected} scenario={scenario} value={settingsDraft} onChange={setSettingsDraft} />
                  ) : (
                    <CanvasMapEditor key={selected} value={mapDraft} onChange={onMapEditorChange} mods={scenarioMods} ownerLabels={scenarioSides} />
                  )
                ) : (
                  <div className={styles.monaco}>
                    <Editor
                      height="100%"
                      theme="vs-dark"
                      language="json"
                      value={current}
                      onChange={(v) => (isSettings ? setSettingsDraft(v ?? '') : setMapDraft(v ?? ''))}
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
                  // a real .js path: without an extension the language service
                  // reads the file as TypeScript and ignores its JSDoc types
                  path={'file:///scenarios/' + encodeURI(scenario + '/' + selected)}
                  value={annotated.value}
                  beforeMount={beforeMount}
                  onMount={onMount}
                  onChange={(v) => setContent(annotate ? stripAnnotation(v ?? '') : v ?? '')}
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
              <button onClick={() => window.open(api.activateUrlFor(scenario), '_blank')}>Open in browser</button>
              <button onClick={async () => { const st = await api.tokenStatus(scenario).catch(() => null); if (st && !st.needsActivation) { setToken(null); runImport(); } else setToken(st); }}>Retry</button>
              <button onClick={() => setToken(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
