//! Water model — MUST mirror src/theme/units.ts.
//! Reading (input + cached context) is ~10x cheaper than writing (output).
//! Rates are mL per token. v1 uses these defaults; a later milestone can read
//! overrides from the settings store.

pub const READ_ML_PER_TOKEN: f64 = 0.0002; // input, cache_read, cache_creation
pub const WRITE_ML_PER_TOKEN: f64 = 0.0015; // output

#[inline]
pub fn water_ml(input: i64, output: i64, cache_create: i64, cache_read: i64) -> f64 {
    let read = (input + cache_create + cache_read) as f64;
    READ_ML_PER_TOKEN * read + WRITE_ML_PER_TOKEN * (output as f64)
}

/// Deterministic hue (0..360) from a project id, so colors are stable.
pub fn hue_for(id: &str) -> i64 {
    let mut h: u32 = 2166136261;
    for b in id.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16777619);
    }
    (h % 360) as i64
}
