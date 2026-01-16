import crypto from 'crypto';

export class ConsistentHash {
  private ring: Map<number, string> = new Map();
  private nodes: Set<string> = new Set();
  private virtualNodesPerNode: number = 150;

  addNode(nodeId: string): void {
    this.nodes.add(nodeId);

    for (let i = 0; i < this.virtualNodesPerNode; i++) {
      const virtualNodeKey = `${nodeId}:${i}`;
      const hash = this.hash(virtualNodeKey);
      this.ring.set(hash, nodeId);
    }
  }

  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);

    for (let i = 0; i < this.virtualNodesPerNode; i++) {
      const virtualNodeKey = `${nodeId}:${i}`;
      const hash = this.hash(virtualNodeKey);
      this.ring.delete(hash);
    }
  }

  getNode(key: string): string | null {
    if (this.nodes.size === 0) {
      return null;
    }

    const hash = this.hash(key);
    const sortedHashes = Array.from(this.ring.keys()).sort((a, b) => a - b);

    for (const ringHash of sortedHashes) {
      if (ringHash >= hash) {
        return this.ring.get(ringHash) || null;
      }
    }

    // Wrap around to the first node
    return this.ring.get(sortedHashes[0]) || null;
  }

  private hash(key: string): number {
    const md5 = crypto.createHash('md5').update(key).digest();
    return md5.readUInt32BE(0);
  }

  getNodes(): string[] {
    return Array.from(this.nodes);
  }

  getNodeCount(): number {
    return this.nodes.size;
  }
}
