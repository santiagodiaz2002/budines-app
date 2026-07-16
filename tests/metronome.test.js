import { describe, expect, it } from 'vitest';
import {
  advancePlaybackRuntime,
  advanceRuntime,
  cloneSongAsNew,
  createMetronomeMachine,
  createPlaybackRuntime,
  createRuntime,
  createSong,
  createSongPlaybackMachine,
  deleteSongFromLibrary,
  findSong,
  hasUnsavedBlockChanges,
  moveBlock,
  normalizeBlocks,
  parseBpm,
  parseMeasures,
  parsePartName,
  renameSongInLibrary,
  removeBlock,
  sanitizeSongLibrary,
  selectPreferredVoice,
  updateSong,
  upsertSongInLibrary,
  validateEditableBlocks
} from '../public/js/metronome-core.js';

describe('metrónomo 4/4', () => {
  it('valida BPM con enteros estrictos entre 30 y 300', () => {
    for (const invalid of ['', '0', '-1', '120.5', '1e2', 'texto', '301']) {
      expect(parseBpm(invalid).ok).toBe(false);
    }

    expect(parseBpm('30')).toEqual({ ok: true, value: 30 });
    expect(parseBpm('300')).toEqual({ ok: true, value: 300 });
  });

  it('valida compases con enteros estrictos entre 1 y 999', () => {
    for (const invalid of ['', '0', '-4', '4.5', '1e2', 'mil', '1000']) {
      expect(parseMeasures(invalid).ok).toBe(false);
    }

    expect(parseMeasures('1')).toEqual({ ok: true, value: 1 });
    expect(parseMeasures('999')).toEqual({ ok: true, value: 999 });
  });

  it('avanza pulso, compás, bloque, BPM y vuelve del último bloque al primero', () => {
    const blocks = normalizeBlocks([
      { measures: 1, bpm: 100 },
      { measures: 1, bpm: 140 }
    ]);
    let runtime = createRuntime(blocks);

    expect(runtime).toMatchObject({ blockIndex: 0, measureInBlock: 1, beatInMeasure: 1, bpm: 100 });

    runtime = advanceRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ blockIndex: 0, beatInMeasure: 2, bpm: 100 });
    runtime = advanceRuntime(runtime, blocks);
    runtime = advanceRuntime(runtime, blocks);
    runtime = advanceRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ blockIndex: 1, measureInBlock: 1, beatInMeasure: 1, bpm: 140 });

    runtime = advanceRuntime(runtime, blocks);
    runtime = advanceRuntime(runtime, blocks);
    runtime = advanceRuntime(runtime, blocks);
    runtime = advanceRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ blockIndex: 0, measureInBlock: 1, beatInMeasure: 1, bpm: 100 });
  });

  it('pausa, reanuda y stop conserva/restablece estado esperado', () => {
    const machine = createMetronomeMachine([{ measures: 2, bpm: 120 }]);

    expect(machine.start()).toBe(true);
    expect(machine.start()).toBe(false);
    expect(machine.snapshot().schedulerActive).toBe(true);

    machine.tick();
    expect(machine.snapshot().runtime.beatInMeasure).toBe(2);

    expect(machine.pause()).toBe(true);
    expect(machine.snapshot()).toMatchObject({ running: true, paused: true, schedulerActive: false });

    expect(machine.resume()).toBe(true);
    expect(machine.snapshot()).toMatchObject({ running: true, paused: false, schedulerActive: true });

    machine.stop();
    expect(machine.snapshot()).toMatchObject({
      running: false,
      paused: false,
      schedulerActive: false,
      runtime: { blockIndex: 0, measureInBlock: 1, beatInMeasure: 1, bpm: 120 }
    });
  });

  it('crea, guarda, actualiza, duplica, abre, renombra y elimina canciones locales', () => {
    const idFactory = createDeterministicIds();
    const now = '2026-07-15T12:00:00.000Z';
    const rows = [
      { name: 'Intro', measures: '2', bpm: '80' },
      { name: 'Verso', measures: '2', bpm: '100' },
      { name: 'Coro', measures: '2', bpm: '120' }
    ];

    const created = createSong({ name: 'Tres Budines', blocks: rows, now, idFactory });
    expect(created.ok).toBe(true);
    expect(created.song).toMatchObject({
      name: 'Tres Budines',
      createdAt: now,
      updatedAt: now
    });
    expect(created.song.blocks.map((block) => block.name)).toEqual(['Intro', 'Verso', 'Coro']);

    let library = sanitizeSongLibrary({ songs: [] });
    let upsert = upsertSongInLibrary(library, created.song);
    expect(upsert.ok).toBe(true);
    library = upsert.library;
    expect(library.songs).toHaveLength(1);

    const updated = updateSong(created.song, {
      now: '2026-07-15T12:10:00.000Z',
      blocks: [...created.song.blocks, { name: 'Final', measures: '1', bpm: '90' }],
      idFactory
    });
    expect(updated.ok).toBe(true);
    library = upsertSongInLibrary(library, updated.song).library;
    expect(library.songs).toHaveLength(1);
    expect(findSong(library, created.song.id).blocks).toHaveLength(4);

    const duplicated = cloneSongAsNew(updated.song, { name: 'Tres Budines copia', now, idFactory });
    expect(duplicated.ok).toBe(true);
    expect(duplicated.song.id).not.toBe(updated.song.id);
    library = upsertSongInLibrary(library, duplicated.song).library;
    expect(library.songs).toHaveLength(2);

    const stored = JSON.stringify(library);
    const reloaded = sanitizeSongLibrary(JSON.parse(stored));
    expect(findSong(reloaded, duplicated.song.id).name).toBe('Tres Budines copia');

    const renamed = renameSongInLibrary(reloaded, duplicated.song.id, 'Ensayo', { now });
    expect(renamed.ok).toBe(true);
    expect(findSong(renamed.library, duplicated.song.id).name).toBe('Ensayo');

    const canceled = deleteSongFromLibrary(renamed.library, duplicated.song.id, { confirmed: false });
    expect(canceled.deleted).toBe(false);
    expect(canceled.library.songs).toHaveLength(2);

    const deleted = deleteSongFromLibrary(renamed.library, duplicated.song.id, { confirmed: true });
    expect(deleted.deleted).toBe(true);
    expect(deleted.library.songs).toHaveLength(1);
  });

  it('valida nombres y conserva canciones validas ante datos locales corruptos', () => {
    expect(createSong({ name: '', blocks: [{ name: 'Intro', measures: '1', bpm: '100' }] }).ok).toBe(false);
    expect(parsePartName('   ').ok).toBe(false);
    expect(parsePartName('A'.repeat(41)).ok).toBe(false);
    expect(parsePartName('Coro <script>alert(1)</script>')).toEqual({
      ok: true,
      value: 'Coro <script>alert(1)</script>'
    });

    const idFactory = createDeterministicIds();
    const valid = createSong({
      name: 'Valida',
      blocks: [{ name: 'Intro', measures: '1', bpm: '100' }],
      idFactory
    }).song;
    const library = sanitizeSongLibrary({
      schemaVersion: 1,
      songs: [
        valid,
        { schemaVersion: 1, id: 'rota', name: 'Rota', blocks: [{ name: '', measures: 1, bpm: 100 }] },
        { schemaVersion: 999, id: 'futura', name: 'Futura', blocks: valid.blocks }
      ]
    });

    expect(library.songs).toHaveLength(1);
    expect(library.songs[0].name).toBe('Valida');
  });

  it('edita bloques con nombre, validacion estricta, reordenamiento y minimo de un bloque', () => {
    const idFactory = createDeterministicIds();
    const validation = validateEditableBlocks(
      [
        { name: 'Intro', measures: '4', bpm: '100' },
        { name: 'Coro', measures: '8', bpm: '125' }
      ],
      { idFactory }
    );
    expect(validation.ok).toBe(true);
    expect(validation.blocks.map((block) => block.order)).toEqual([0, 1]);

    expect(validateEditableBlocks([{ name: '', measures: '4', bpm: '100' }]).ok).toBe(false);
    expect(validateEditableBlocks([{ name: 'Intro', measures: '4.5', bpm: '100' }]).ok).toBe(false);
    expect(validateEditableBlocks([{ name: 'Intro', measures: '4', bpm: '1e2' }]).ok).toBe(false);
    expect(validateEditableBlocks([]).ok).toBe(false);

    const moved = moveBlock(validation.blocks, 1, 0);
    expect(moved.map((block) => block.name)).toEqual(['Coro', 'Intro']);

    const removed = removeBlock(moved, 1);
    expect(removed.ok).toBe(true);
    expect(removed.blocks).toHaveLength(1);
    expect(removeBlock(removed.blocks, 0).ok).toBe(false);
  });

  it('detecta cambios sin guardar comparando la secuencia editable', () => {
    const saved = normalizeBlocks([{ name: 'Intro', measures: 2, bpm: 80 }]);
    const same = normalizeBlocks([{ name: 'Intro', measures: 2, bpm: 80 }]);
    const changed = normalizeBlocks([{ name: 'Intro', measures: 3, bpm: 80 }]);

    expect(hasUnsavedBlockChanges(same, saved)).toBe(false);
    expect(hasUnsavedBlockChanges(changed, saved)).toBe(true);
  });

  it('anuncia, cuenta tres pulsos al BPM entrante, reproduce y cambia de bloque en limite', () => {
    const blocks = normalizeBlocks([
      { id: 'intro', name: 'Intro', measures: 1, bpm: 80, order: 0 },
      { id: 'verso', name: 'Verso', measures: 1, bpm: 100, order: 1 }
    ]);
    let runtime = createPlaybackRuntime(blocks);

    expect(runtime).toMatchObject({ phase: 'announce', blockIndex: 0, bpm: 80 });

    runtime = advancePlaybackRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ phase: 'countIn', countInBeat: 3, measureInBlock: 1, bpm: 80 });
    runtime = advancePlaybackRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ phase: 'countIn', countInBeat: 2, bpm: 80 });
    runtime = advancePlaybackRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ phase: 'countIn', countInBeat: 1, bpm: 80 });

    runtime = advancePlaybackRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ phase: 'playing', blockIndex: 0, measureInBlock: 1, beatInMeasure: 1, bpm: 80 });

    runtime = advancePlaybackRuntime(runtime, blocks);
    runtime = advancePlaybackRuntime(runtime, blocks);
    runtime = advancePlaybackRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ phase: 'playing', blockIndex: 0, beatInMeasure: 4, bpm: 80 });

    runtime = advancePlaybackRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ phase: 'announce', blockIndex: 1, bpm: 100 });

    runtime = advancePlaybackRuntime(runtime, blocks);
    expect(runtime).toMatchObject({ phase: 'countIn', countInBeat: 3, bpm: 100 });
  });

  it('vuelve del ultimo bloque al primero y la maquina evita schedulers duplicados', () => {
    const blocks = normalizeBlocks([
      { id: 'intro', name: 'Intro', measures: 1, bpm: 80, order: 0 },
      { id: 'coro', name: 'Coro', measures: 1, bpm: 120, order: 1 }
    ]);
    const machine = createSongPlaybackMachine(blocks);

    expect(machine.start()).toBe(true);
    expect(machine.start()).toBe(false);
    expect(machine.snapshot()).toMatchObject({ running: true, paused: false, schedulerActive: true });

    machine.tick();
    machine.tick();
    machine.tick();
    machine.tick();
    machine.tick();
    machine.tick();
    machine.tick();
    machine.tick();
    expect(machine.snapshot().runtime).toMatchObject({ phase: 'announce', blockIndex: 1, bpm: 120 });

    expect(machine.pause()).toBe(true);
    const paused = machine.snapshot().runtime;
    expect(machine.resume()).toBe(true);
    expect(machine.snapshot().runtime).toEqual(paused);

    for (let index = 0; index < 8; index += 1) {
      machine.tick();
    }
    expect(machine.snapshot().runtime).toMatchObject({ phase: 'announce', blockIndex: 0, bpm: 80 });

    machine.stop();
    expect(machine.snapshot()).toMatchObject({
      running: false,
      paused: false,
      schedulerActive: false,
      runtime: { phase: 'announce', blockIndex: 0, bpm: 80 }
    });
  });

  it('selecciona voz es-AR, cae a otra voz espanola y luego a cualquier voz', () => {
    const voices = [
      { name: 'English', lang: 'en-US' },
      { name: 'Espanol', lang: 'es-ES' },
      { name: 'Argentina', lang: 'es-AR' }
    ];
    expect(selectPreferredVoice(voices).name).toBe('Argentina');
    expect(selectPreferredVoice(voices.slice(0, 2)).name).toBe('Espanol');
    expect(selectPreferredVoice([{ name: 'Default', lang: 'en-US' }]).name).toBe('Default');
    expect(selectPreferredVoice([])).toBeNull();
  });
});

function createDeterministicIds() {
  let index = 0;
  return (prefix = 'id') => {
    index += 1;
    return `${prefix}-${index}`;
  };
}
