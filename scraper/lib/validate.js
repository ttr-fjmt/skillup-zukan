'use strict';

/**
 * schema/school.schema.json による School レコードのバリデーション。
 *
 * 収集パイプライン（discover-schools.js）が新規レコードを data/schools.json に
 * 書き込む前段の関門として使う。AIが生成した値をそのまま信用せず、enum・必須項目・
 * format=online なのに area が入っている等の矛盾を機械的に弾くための層。
 * agent-zukan / freelance-anken-zukan では「未知のカテゴリーが返ってきたら
 * その他に丸める」という個別の防御を書いていたが、フィールドが増えた本サイトでは
 * JSON Schema に一本化する。
 */

const fs = require('fs');
const path = require('path');
// schema/school.schema.json は draft 2020-12 なので、ajv本体ではなく 2020-12 用の
// エントリポイントを使う（ajv本体は draft-07 用で、$schema を解決できずに落ちる）。
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'schema', 'school.schema.json');

let cachedValidator = null;

/** ajvのコンパイルは重いので、プロセス内で1回だけ行い使い回す。 */
function getValidator() {
  if (cachedValidator) return cachedValidator;
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

/** ajvのエラー配列を、ログにそのまま出せる1行の日本語混じり文字列群に整形する。 */
function formatErrors(errors) {
  return (errors || []).map(e => {
    const where = e.instancePath || '(root)';
    const allowed = e.params && Array.isArray(e.params.allowedValues)
      ? `（許容値: ${e.params.allowedValues.join(', ')}）`
      : '';
    return `${where} ${e.message}${allowed}`;
  });
}

/**
 * 1件のSchoolレコードを検証する。
 * 戻り値: { ok: boolean, errors: string[] }
 */
function validateSchool(school) {
  const validate = getValidator();
  const ok = validate(school);
  return { ok, errors: ok ? [] : formatErrors(validate.errors) };
}

/**
 * 配列全体を検証する。1件でもNGがあれば ok:false だが、どのレコードが
 * なぜNGなのかを全件分まとめて返す（1件ずつ直しては再実行、を避けるため）。
 * id の重複も併せて検出する（JSON Schema単体では表現できないため）。
 */
function validateSchools(schools) {
  const invalid = [];
  const seenIds = new Map();
  const duplicateIds = [];

  schools.forEach((school, index) => {
    const { ok, errors } = validateSchool(school);
    if (!ok) {
      invalid.push({ index, id: school && school.id, errors });
    }
    const id = school && school.id;
    if (id) {
      if (seenIds.has(id)) duplicateIds.push({ id, indexes: [seenIds.get(id), index] });
      else seenIds.set(id, index);
    }
  });

  return { ok: invalid.length === 0 && duplicateIds.length === 0, invalid, duplicateIds };
}

module.exports = { SCHEMA_PATH, validateSchool, validateSchools, formatErrors };
