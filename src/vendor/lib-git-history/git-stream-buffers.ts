// @ts-nocheck
export interface TextStreamState {
  buffer: string;
  searchOffset: number;
  droppingMassiveCommit: boolean;
}

export interface BinaryStreamState {
  chunks: Buffer[];
  chunksLength: number;
  droppingMassiveRecord: boolean;
}

export function drainTextBuffer(
  state: TextStreamState,
  chunkLen: number,
  maxBufferLimit: number,
  recordSeparator: string,
): string[] {
  const records: string[] = [];
  if (state.droppingMassiveCommit) {
    const nextBoundary = state.buffer.indexOf(recordSeparator);
    if (nextBoundary === -1) {
      state.buffer =
        state.buffer.length > recordSeparator.length
          ? (' ' + state.buffer.slice(-(recordSeparator.length - 1))).slice(1)
          : state.buffer;
      state.searchOffset = 0;
      return records;
    }
    state.droppingMassiveCommit = false;
    state.buffer = (' ' + state.buffer.slice(nextBoundary + recordSeparator.length)).slice(1);
    state.searchOffset = 0;
  }

  let lastSlice = 0;
  let sepIdx: number;
  while ((sepIdx = state.buffer.indexOf(recordSeparator, state.searchOffset)) !== -1) {
    const record = state.buffer.slice(lastSlice, sepIdx);
    if (record.trim()) {
      if (record.length >= maxBufferLimit) {
        console.warn(`Warning: Git record exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping massive commit.`);
      } else {
        records.push(record);
      }
    }
    lastSlice = sepIdx + recordSeparator.length;
    state.searchOffset = lastSlice;
  }

  if (lastSlice > 0) {
    state.buffer = (' ' + state.buffer.slice(lastSlice)).slice(1);
    state.searchOffset = Math.max(0, state.searchOffset - lastSlice);
  } else {
    state.searchOffset = Math.max(0, state.buffer.length - chunkLen - recordSeparator.length);
  }

  if (state.buffer.length > maxBufferLimit) {
    console.warn(`Warning: Git record buffer exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping massive commit to prevent memory exhaustion.`);
    state.buffer =
      state.buffer.length > recordSeparator.length
        ? (' ' + state.buffer.slice(-(recordSeparator.length - 1))).slice(1)
        : state.buffer;
    state.searchOffset = 0;
    state.droppingMassiveCommit = true;
  }
  return records;
}

export function hasCrossChunkBoundary(chunks: Buffer[], buf: Buffer, boundary: Buffer): boolean {
  const needed = boundary.length - 1;
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

function retainBoundaryTail(state: BinaryStreamState, pendingBuffer: Buffer, boundaryLen: number): void {
  const tailLen = Math.max(0, boundaryLen - 1);
  const tailSlice =
    tailLen > 0 && pendingBuffer.length > tailLen
      ? pendingBuffer.subarray(pendingBuffer.length - tailLen)
      : pendingBuffer;
  const copied = tailSlice.length > 0 ? Buffer.from(tailSlice) : null;
  state.chunks = copied ? [copied] : [];
  state.chunksLength = copied ? copied.length : 0;
}

export function drainBinaryChunks(
  state: BinaryStreamState,
  boundary: Buffer,
  maxBufferLimit: number,
): Buffer[] {
  const emitted: Buffer[] = [];
  let pendingBuffer = Buffer.concat(state.chunks, state.chunksLength);

  if (state.droppingMassiveRecord) {
    const resyncIdx = pendingBuffer.indexOf(boundary);
    if (resyncIdx === -1) {
      retainBoundaryTail(state, pendingBuffer, boundary.length);
      return emitted;
    }
    state.droppingMassiveRecord = false;
    pendingBuffer = pendingBuffer.subarray(resyncIdx + boundary.length);
  }

  let nextIdx = pendingBuffer.indexOf(boundary);
  while (nextIdx !== -1) {
    if (nextIdx > 0) {
      if (nextIdx >= maxBufferLimit) {
        console.warn(`Warning: Git binary record exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping massive record.`);
      } else {
        emitted.push(Buffer.from(pendingBuffer.subarray(0, nextIdx)));
      }
    }
    pendingBuffer = pendingBuffer.subarray(nextIdx + boundary.length);
    nextIdx = pendingBuffer.indexOf(boundary);
  }

  if (pendingBuffer.length > maxBufferLimit) {
    console.warn(`Warning: Git binary buffer exceeded ${Math.round(maxBufferLimit / 1024 / 1024)}MB. Dropping buffer to prevent memory exhaustion.`);
    state.droppingMassiveRecord = true;
    retainBoundaryTail(state, pendingBuffer, boundary.length);
    return emitted;
  }

  state.chunks = pendingBuffer.length > 0 ? [pendingBuffer] : [];
  state.chunksLength = pendingBuffer.length;
  return emitted;
}
