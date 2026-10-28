// POST streams keep hosted work within its HTTP invocation instead of relying
// on a process-local background job after the response has returned.
export async function readCheckStream(response, onSnapshot) {
  if (!response.body) throw new Error('The check stream could not be opened. Please try again.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (!event.split('\n').some((line) => line === 'event: snapshot')) continue;
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        const check = JSON.parse(data);
        onSnapshot(check);
        if (['complete', 'failed'].includes(check.status)) {
          await reader.cancel();
          return;
        }
      }
      if (done)
        throw new Error(
          'The connection ended before this check finished. Try a new check or reopen a completed result from history.',
        );
    }
  } finally {
    reader.releaseLock();
  }
}
