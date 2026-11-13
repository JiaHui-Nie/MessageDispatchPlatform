/** 测试用 R2 兼容层：只实现本平台用到的 put/get/delete/head/list。 */
export class ShimR2 {
  readonly objects = new Map<string, Uint8Array>();
  putCalls = 0;
  deleteCalls = 0;

  async put(key: string, value: unknown): Promise<{ key: string; size: number }> {
    const bytes = toBytes(value);
    this.objects.set(key, bytes);
    this.putCalls += 1;
    return { key, size: bytes.length };
  }

  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) {
      return null;
    }
    return {
      key,
      size: bytes.length,
      body: null,
      async arrayBuffer(): Promise<ArrayBuffer> {
        const copy = new Uint8Array(bytes.length);
        copy.set(bytes);
        return copy.buffer;
      },
      async text(): Promise<string> {
        return new TextDecoder().decode(bytes);
      },
    };
  }

  async head(key: string) {
    const bytes = this.objects.get(key);
    return bytes ? { key, size: bytes.length } : null;
  }

  async delete(keyOrKeys: string | string[]): Promise<void> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    for (const key of keys) {
      this.objects.delete(key);
    }
    this.deleteCalls += 1;
  }

  async list(): Promise<{ objects: Array<{ key: string }>; truncated: boolean }> {
    return { objects: [...this.objects.keys()].map((key) => ({ key })), truncated: false };
  }
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value.slice();
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return new TextEncoder().encode(String(value));
}
