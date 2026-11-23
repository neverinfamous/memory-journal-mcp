// @ts-nocheck
export interface TextStreamState {
  chunks: string[];
  chunksLength: number;
  droppingMassiveCommit: boolean;
}

export interface BinaryStreamState {
  chunks: Buffer[];
  chunksLength: number;
  droppingMassiveRecord: boolean;
}

export function hasCrossChunkTextBoundary(chunks: string[], textChunk: string, recordSeparator: string): boolean {
  const needed = recordSeparator.length - 1;
  if (needed <= 0) return false;
  let gathered = 0;
  const tailParts: string[] = [];
  for (let i = chunks.length - 2; i >= 0 && gathered < needed; i--) {
    const c = chunks[i];
    if (!c) continue;
    const take = Math.min(c.length, needed - gathered);
    tailParts.unshift(c.slice(c.length - take));
    gathered += take;
  }
  tailParts.push(textChunk.slice(0, Math.min(textChunk.length, needed)));
  return tailParts.join('').indexOf(recordSeparator) !== -1;
}

export function retainTextBoundaryTail(state: TextStreamState, tailSource: string, sepLen: number): void {
  const tailLen = Math.max(0, sepLen - 1);
  if (tailLen === 0 || tailSource.length === 0) {
    state.chunks = [];
    state.chunksLength = 0;
    return;
  }
  const sliced = tailSource.length > tailLen ? tailSource.slice(-tailLen) : tailSource;
  const detached = (' ' + sliced).slice(1);
  state.chunks = [detached];
  state.chunksLength = detached.length;
}

export function retainTextBoundaryTailFromChunks(state: TextStreamState, sepLen: number): void {
  const needed = Math.max(0, sepLen - 1);
  if (needed === 0 || state.chunksLength === 0) {
    state.chunks = [];
    state.chunksLength = 0;
    return;
  }
  const last = state.chunks[state.chunks.length - 1];
  if (last && last.length >= needed) {
    retainTextBoundaryTail(state, last, sepLen);
    return;
  }
  let gathered = 0;
  const tailParts: string[] = [];
  for (let i = state.chunks.length - 1; i >= 0 && gathered < needed; i--) {
    const c = state.chunks[i];
    if (!c) continue;
    const take = Math.min(c.length, needed - gathered);
    tailParts.unshift(c.slice(c.length - take));
    gathered += take;
  }
  retainTextBoundaryTail(state, tailParts.join(''), sepLen);
}

export function drainTextChunks(
  state: TextStreamState,
  maxBufferLimit: number,
  recordSeparator: string,
): string[] {
  const records: string[] = [];
  const pending = state.chunks.length === 1 && state.chunks[0] !== undefined ? state.chunks[0] : state.chunks.join('');
  let cursor = 0;

  if (state.droppingMassiveCommit) {
    const nextBoundary = pending.indexOf(recordSeparator, cursor);
    if (nextBoundary === -1) {
      retainTextBoundaryTail(state, pending, recordSeparator.length);
      return records;
    }
    state.droppingMassiveCommit = false;
    cursor = nextBoundary + recordSeparator.length;
  }

  let sepIdx = pending.indexOf(recordSeparator, cursor);
  while (sepIdx !== -1) {
    const recordLen = sepIdx - cursor;
    if (recordLen > 0) {
      if (recordLen >= maxBufferLimit) {
        console.warn(`Warning: Git record exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping massive commit.`);
      } else {
        const record = pending.slice(cursor, sepIdx);
        if (record.trim()) records.push(record);
      }
    }
    cursor = sepIdx + recordSeparator.length;
    sepIdx = pending.indexOf(recordSeparator, cursor);
  }

  const remainingLen = pending.length - cursor;
  if (remainingLen >= maxBufferLimit) {
    console.warn(`Warning: Git record buffer exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping massive commit to prevent memory exhaustion.`);
    state.droppingMassiveCommit = true;
    retainTextBoundaryTail(state, pending.slice(cursor), recordSeparator.length);
    return records;
  }

  if (remainingLen > 0) {
    const remaining = cursor === 0 ? pending : (' ' + pending.slice(cursor)).slice(1);
    state.chunks = [remaining];
    state.chunksLength = remaining.length;
  } else {
    state.chunks = [];
    state.chunksLength = 0;
  }
  return records;
}

export function hasCrossChunkBoundary(chunks: Buffer[], buf: Buffer, boundary: Buffer): boolean {
  const needed = boundary.length - 1;
  if (needed <= 0) return false;
  let gathered = 0;
  const tailChunks: Buffer[] = [];
  for (let i = chunks.length - 2; i >= 0 && gathered < needed; i--) {
    const c = chunks[i];
    if (!c) continue;
    const take = Math.min(c.length, needed - gathered);
    tailChunks.unshift(c.subarray(c.length - take));
    gathered += take;
  }
  const headSlice = buf.subarray(0, Math.min(buf.length, needed));
  tailChunks.push(headSlice);
  return Buffer.concat(tailChunks, gathered + headSlice.length).indexOf(boundary) !== -1;
}

export function retainBoundaryTail(state: BinaryStreamState, pendingBuffer: Buffer, boundaryLen: number): void {
  const tailLen = Math.max(0, boundaryLen - 1);
  if (tailLen === 0 || pendingBuffer.length === 0) {
    state.chunks = [];
    state.chunksLength = 0;
    return;
  }
  const tailSlice = pendingBuffer.length > tailLen ? pendingBuffer.subarray(pendingBuffer.length - tailLen) : pendingBuffer;
  const copied = Buffer.from(tailSlice);
  state.chunks = [copied];
  state.chunksLength = copied.length;
}

export function retainBoundaryTailFromChunks(state: BinaryStreamState, boundaryLen: number): void {
  const needed = Math.max(0, boundaryLen - 1);
  if (needed === 0 || state.chunksLength === 0) {
    state.chunks = [];
    state.chunksLength = 0;
    return;
  }
  const last = state.chunks[state.chunks.length - 1];
  if (last && last.length >= needed) {
    retainBoundaryTail(state, last, boundaryLen);
    return;
  }
  let gathered = 0;
  const tailChunks: Buffer[] = [];
  for (let i = state.chunks.length - 1; i >= 0 && gathered < needed; i--) {
    const c = state.chunks[i];
    if (!c) continue;
    const take = Math.min(c.length, needed - gathered);
    tailChunks.unshift(c.subarray(c.length - take));
    gathered += take;
  }
  retainBoundaryTail(state, Buffer.concat(tailChunks, gathered), boundaryLen);
}

export function drainBinaryChunks(
  state: BinaryStreamState,
  boundary: Buffer,
  maxBufferLimit: number,
): Buffer[] {
  const emitted: Buffer[] = [];
  const pendingBuffer =
    state.chunks.length === 1 && state.chunks[0] !== undefined
      ? state.chunks[0]
      : Buffer.concat(state.chunks, state.chunksLength);
  let cursor = 0;

  if (state.droppingMassiveRecord) {
    const resyncIdx = pendingBuffer.indexOf(boundary, cursor);
    if (resyncIdx === -1) {
      retainBoundaryTail(state, pendingBuffer, boundary.length);
      return emitted;
    }
    state.droppingMassiveRecord = false;
    cursor = resyncIdx + boundary.length;
  }

  let nextIdx = pendingBuffer.indexOf(boundary, cursor);
  while (nextIdx !== -1) {
    const recordLen = nextIdx - cursor;
    if (recordLen > 0) {
      if (recordLen >= maxBufferLimit) {
        console.warn(`Warning: Git binary record exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping massive record.`);
      } else {
        emitted.push(pendingBuffer.subarray(cursor, nextIdx));
      }
    }
    cursor = nextIdx + boundary.length;
    nextIdx = pendingBuffer.indexOf(boundary, cursor);
  }

  const remainingLen = pendingBuffer.length - cursor;
  if (remainingLen >= maxBufferLimit) {
    console.warn(`Warning: Git binary buffer exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping buffer to prevent memory exhaustion.`);
    state.droppingMassiveRecord = true;
    retainBoundaryTail(state, pendingBuffer.subarray(cursor), boundary.length);
    return emitted;
  }

  if (remainingLen > 0) {
    const tail = cursor === 0 ? pendingBuffer : pendingBuffer.subarray(cursor);
    // [INTENT]: Copy only the residual tail when it pins a significantly larger slab so the slab can be GC'd.
    const retained = tail.buffer.byteLength > remainingLen * 2 ? Buffer.from(tail) : tail;
    state.chunks = [retained];
    state.chunksLength = retained.length;
  } else {
    state.chunks = [];
    state.chunksLength = 0;
  }
  return emitted;
}
