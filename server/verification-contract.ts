import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type {Request} from './contracts/birbverify.v1/request';
import type {Manifest} from './contracts/birbverify.v1/manifest';

const ajv = new Ajv({strict: true});
addFormats(ajv);
const schema = (name: string) => JSON.parse(readFileSync(new URL(`./contracts/birbverify.v1/${name}.schema.json`, import.meta.url), 'utf8'));
export const validVerificationRequest = ajv.compile<Request>(schema('request'));
export const validVerificationManifest = ajv.compile<Manifest>(schema('manifest'));
