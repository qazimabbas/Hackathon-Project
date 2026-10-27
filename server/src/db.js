import mongoose from 'mongoose';
import dns from 'node:dns';
import { config, hasSecret } from './config.js';

let databasePromise;
export async function getDatabase() {
  if (!hasSecret(config.MONGODB_URI)) throw new Error('Database not configured.');
  if (!databasePromise) {
    if (config.MONGODB_DNS_SERVERS.trim())
      dns.setServers(config.MONGODB_DNS_SERVERS.split(',').map((value) => value.trim()));
    const connection = mongoose.createConnection(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      autoIndex: true,
    });
    connection.on('error', () => {});
    databasePromise = connection.asPromise().catch(async () => {
      databasePromise = undefined;
      await connection.close().catch(() => {});
      throw new Error('Database connection unavailable.');
    });
  }
  return databasePromise;
}

export async function verifyDatabase() {
  if (!hasSecret(config.MONGODB_URI))
    return {
      ok: false,
      code: 'MISSING_MONGODB_URI',
      message: 'Add MONGODB_URI to .env to enable saved history, caching, and statistics.',
    };
  // User-selected process-only resolvers. No operating-system settings change.
  if (config.MONGODB_DNS_SERVERS.trim())
    dns.setServers(config.MONGODB_DNS_SERVERS.split(',').map((value) => value.trim()));
  // Use a separate, read-only connection check; never log driver error messages.
  const connection = mongoose.createConnection(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    autoCreate: false,
    autoIndex: false,
  });
  try {
    await connection.asPromise();
    await connection.db.admin().ping();
    return { ok: true, code: 'MONGODB_OK', message: 'MongoDB Atlas connection verified.' };
  } catch (error) {
    if (error.code === 18 || error.codeName === 'AuthenticationFailed')
      return {
        ok: false,
        code: 'MONGODB_AUTH',
        message:
          'Atlas rejected authentication. Check the database user and password in MONGODB_URI.',
      };
    if (
      error.syscall === 'querySrv' ||
      error.syscall === 'queryTxt' ||
      ['ENOTFOUND', 'ECONNREFUSED', 'ESERVFAIL', 'ETIMEOUT'].includes(error.code)
    )
      return {
        ok: false,
        code: 'MONGODB_DNS',
        message:
          'Atlas DNS lookup failed. Confirm the cluster is active and the connection string is current. Check this network’s DNS support for MongoDB Atlas SRV records.',
      };
    return {
      ok: false,
      code: 'MONGODB_CONNECTION',
      message:
        'Could not reach Atlas. Check the connection string, cluster availability, and Atlas network access for this computer.',
    };
  } finally {
    await connection.close().catch(() => {});
  }
}
