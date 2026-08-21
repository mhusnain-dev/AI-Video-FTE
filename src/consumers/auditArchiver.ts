/**
 * Audit Archiver Consumer
 * Consumes story_events stream and batches events to S3/GCS for 7-year retention
 * Implements FR-033, NFR-006, GDPR-001
 */

import type { ConsumerOptions } from './baseConsumer.js';
import { BaseConsumer } from './baseConsumer.js';
import { query } from '../shared/db.js';
import type { StreamMessage, StateChangeEvent } from '../shared/types.js';
import { STREAMS } from '../shared/redis.js';

export interface AuditArchiverOptions extends ConsumerOptions {
  /** Storage backend: 's3' | 'gcs' | 'local' */
  storageBackend: 's3' | 'gcs' | 'local';
  /** S3/GCS bucket name */
  bucketName: string;
  /** Directory prefix in bucket */
  prefix?: string;
  /** Batch size before flush */
  batchSize?: number;
  /** Max time to wait before flush (ms) */
  flushIntervalMs?: number;
  /** Compression algorithm: 'gzip' | 'none' */
  compression?: 'gzip' | 'none';
  /** Encryption key for local storage */
  encryptionKey?: string;
  /** Local storage path (for local backend) */
  localPath?: string;
}

interface ArchiveEvent {
  event: StateChangeEvent;
  receivedAt: Date;
  stream: string;
  messageId: string;
}

export class AuditArchiverConsumer extends BaseConsumer {
  private readonly storageBackend: 's3' | 'gcs' | 'local';
  private readonly bucketName: string;
  private readonly prefix: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly compression: 'gzip' | 'none';
  private readonly encryptionKey?: string;
  private readonly localPath?: string;

  private buffer: ArchiveEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushPromise: Promise<void> | null = null;

  constructor(options: AuditArchiverOptions) {
    super({
      ...options,
      groupName: options.groupName,
      consumerName: options.consumerName,
      stream: options.stream,
      count: options.count ?? 100,
      blockMs: options.blockMs ?? 5000,
    });

    this.storageBackend = options.storageBackend;
    this.bucketName = options.bucketName;
    this.prefix = options.prefix ?? 'story-events';
    this.batchSize = options.batchSize ?? 1000;
    this.flushIntervalMs = options.flushIntervalMs ?? 30000; // 30 seconds
    this.compression = options.compression ?? 'gzip';
    this.encryptionKey = options.encryptionKey;
    this.localPath = options.localPath;
  }

  async start(): Promise<void> {
    await super.start();

    // Start periodic flush
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
    this.flushTimer.unref();

    console.log(`Audit Archiver started: ${this.storageBackend}://${this.bucketName}/${this.prefix}`);
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Wait for any in-progress flush
    if (this.flushPromise) {
      await this.flushPromise;
    }

    // Flush remaining buffer
    await this.flush();
    await super.stop();
  }

  protected async processMessage(message: StreamMessage): Promise<void> {
    if (message.stream !== STREAMS.STORY_EVENTS && message.stream !== STREAMS.JOB_STATUS) {
      return;
    }

    const event = this.parseStateChangeEvent(message);
    if (!event) return;

    const archiveEvent: ArchiveEvent = {
      event,
      receivedAt: new Date(),
      stream: message.stream,
      messageId: message.id,
    };

    this.buffer.push(archiveEvent);

    // Flush if batch size reached
    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Prevent concurrent flushes
    if (this.flushPromise) {
      return this.flushPromise;
    }

    this.flushPromise = this.doFlush();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  private async doFlush(): Promise<void> {
    const eventsToArchive = this.buffer.splice(0, this.batchSize);
    if (eventsToArchive.length === 0) return;

    const timestamp = new Date();
    const dateStr = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD
    const hourStr = timestamp.getHours().toString().padStart(2, '0');
    const minuteStr = timestamp.getMinutes().toString().padStart(2, '0');

    const objectKey = `${this.prefix}/${dateStr}/${hourStr}/${minuteStr}/${Date.now()}.jsonl${this.compression === 'gzip' ? '.gz' : ''}`;

    try {
      const content = this.serializeEvents(eventsToArchive);
      const compressed = this.compression === 'gzip'
        ? await this.compress(content)
        : Buffer.from(content, 'utf-8');

      await this.writeToStorage(objectKey, compressed);

      // Log archive success
      console.log(`Archived ${eventsToArchive.length} events to ${objectKey}`);

      // Persist archive metadata to database
      await query(
        `INSERT INTO audit_archives (object_key, storage_backend, bucket_name, event_count, bytes, archived_at, first_event_id, last_event_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          objectKey,
          this.storageBackend,
          this.bucketName,
          eventsToArchive.length,
          compressed.length,
          timestamp,
          eventsToArchive[0].messageId,
          eventsToArchive[eventsToArchive.length - 1].messageId,
        ]
      );
    } catch (error) {
      console.error('Audit archive flush failed:', error);
      // Put events back in buffer for retry
      this.buffer.unshift(...eventsToArchive);
      throw error;
    }
  }

  private serializeEvents(events: ArchiveEvent[]): string {
    return events.map(e => JSON.stringify({
      ...e.event,
      _archive: {
        receivedAt: e.receivedAt.toISOString(),
        stream: e.stream,
        messageId: e.messageId,
      }
    })).join('\n') + '\n';
  }

  private async compress(data: string): Promise<Buffer> {
    const zlib = await import('zlib');
    return new Promise((resolve, reject) => {
      zlib.gzip(Buffer.from(data, 'utf-8'), (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  private async writeToStorage(key: string, data: Buffer): Promise<void> {
    switch (this.storageBackend) {
      case 's3':
        await this.writeToS3(key, data);
        break;
      case 'gcs':
        await this.writeToGCS(key, data);
        break;
      case 'local':
        await this.writeToLocal(key, data);
        break;
    }
  }

  private async writeToS3(key: string, data: Buffer): Promise<void> {
    // Dynamic import to avoid requiring AWS SDK if not used
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

    await client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: data,
      ContentType: this.compression === 'gzip' ? 'application/gzip' : 'application/jsonlines',
      ServerSideEncryption: 'AES256',
    }));
  }

  private async writeToGCS(key: string, data: Buffer): Promise<void> {
    // Dynamic import to avoid requiring GCS SDK if not used
    const { Storage } = await import('@google-cloud/storage');
    const storage = new Storage();
    const bucket = storage.bucket(this.bucketName);
    const file = bucket.file(key);

    await file.save(data, {
      contentType: this.compression === 'gzip' ? 'application/gzip' : 'application/jsonlines',
      metadata: { cacheControl: 'no-cache' },
    });
  }

  private async writeToLocal(key: string, data: Buffer): Promise<void> {
    const { promises: fs } = await import('fs');
    const { join, dirname } = await import('path');

    if (!this.localPath) {
      throw new Error('localPath required for local storage backend');
    }

    const fullPath = join(this.localPath, key);
    await fs.mkdir(dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
  }

  /**
   * Get archive statistics
   */
  getBufferStats(): { buffered: number; batchSize: number; flushIntervalMs: number } {
    return {
      buffered: this.buffer.length,
      batchSize: this.batchSize,
      flushIntervalMs: this.flushIntervalMs,
    };
  }
}