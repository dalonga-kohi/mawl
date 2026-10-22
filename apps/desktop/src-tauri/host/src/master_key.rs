//! The master key that encrypts the server's stored secrets (provider keys, sign-ins). In desktop
//! mode it lives in Windows Credential Manager (a generic credential of the signed-in user), not
//! in a file. The host resolves it before every spawn and writes it to the server's stdin as the
//! second line, right after the launch token, in the token's encoding: 32 bytes as base64url
//! without padding (43 characters).
//!
//! Resolution, in order:
//! 1. The store holds a key: use it (it must be exactly 32 bytes; anything else is an error and
//!    the entry is never replaced, because a new key would orphan every stored secret).
//! 2. The store is empty and `<data>\secrets\master.key` exists (a server that ran before D1.6
//!    created it): import it. It must be exactly 32 bytes; the host never edits or deletes it.
//!    The server deletes it once the key decrypted a stored secret.
//! 3. Otherwise generate 32 bytes from the OS CSPRNG.
//!
//! In cases 2 and 3 the key is written to the store and read back; only a read-back equal to what
//! was written is used. Every raw byte buffer is wiped after use.

use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

use crate::token::{base64url, REDACTED};

pub const KEY_BYTES: usize = 32;
/// The key's length in base64url characters.
pub const KEY_CHARS: usize = crate::token::TOKEN_CHARS;
/// The server's headless key file, under the data dir; the migration source.
pub const KEY_FILE: &str = "master.key";
pub const SECRETS_DIR: &str = "secrets";
/// The Credential Manager target name of the key.
pub const CREDENTIAL_TARGET: &str = "Mawl/master-key";

/// Overwrites `bytes` with zeros in a way the optimizer does not remove.
pub fn wipe(bytes: &mut [u8]) {
    for byte in bytes.iter_mut() {
        // SAFETY: a valid, aligned, exclusive reference to one byte.
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

/// Raw key material from the store or a file. Wiped on drop.
pub struct KeyBytes(Vec<u8>);

impl KeyBytes {
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(bytes)
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for KeyBytes {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}

impl fmt::Debug for KeyBytes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "KeyBytes({} bytes, [redacted])", self.0.len())
    }
}

/// The master key in its stdin form (base64url). `Debug` and `Display` never print it; use
/// [`MasterKey::expose`]. Wiped on drop.
#[derive(Clone, PartialEq, Eq)]
pub struct MasterKey(String);

impl MasterKey {
    fn from_bytes(bytes: &[u8]) -> Self {
        Self(base64url(bytes))
    }

    /// The secret itself, for the stdin line only.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// `text` with every occurrence of the key replaced by [`REDACTED`].
    pub fn redact(&self, text: &str) -> String {
        text.replace(self.0.as_str(), REDACTED)
    }
}

impl Drop for MasterKey {
    fn drop(&mut self) {
        // SAFETY: zero bytes are valid UTF-8, so the String stays valid until it is freed.
        wipe(unsafe { self.0.as_bytes_mut() });
    }
}

impl fmt::Debug for MasterKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("MasterKey([redacted])")
    }
}

impl fmt::Display for MasterKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

/// Where the key is kept. The real one is Windows Credential Manager
/// ([`credman::CredentialManager`]); tests use an in-memory store.
pub trait KeyStore: Send + Sync {
    /// The stored key, or `None` when there is no entry.
    fn read(&self) -> io::Result<Option<KeyBytes>>;
    /// Creates or replaces the entry. Only called when [`KeyStore::read`] found none.
    fn write(&self, key: &[u8]) -> io::Result<()>;
}

/// How the key was found, for a diagnostics note.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyOrigin {
    Stored,
    /// Imported from `master.key` into the store (D1.6 migration).
    Imported,
    Generated,
}

/// Why no key could be resolved. Messages name sizes and paths, never key bytes.
#[derive(Debug)]
pub enum KeyError {
    /// Reading or writing Windows Credential Manager failed.
    Store(io::Error),
    /// The store holds an entry of the wrong size; it is left as it is.
    StoredSize(usize),
    /// `master.key` exists but could not be read.
    FileRead(PathBuf, io::Error),
    /// `master.key` is not 32 bytes; it is left as it is.
    FileSize(PathBuf, usize),
    /// After a write, the store returned nothing or something else.
    ReadBack,
    /// The OS CSPRNG failed.
    Random,
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KeyError::Store(err) => write!(f, "Windows Credential Manager failed: {err}"),
            KeyError::StoredSize(n) => write!(
                f,
                "the master key in Windows Credential Manager is {n} bytes, not {KEY_BYTES}; it was left unchanged"
            ),
            KeyError::FileRead(path, err) => {
                write!(f, "cannot read the old key file {}: {err}", path.display())
            }
            KeyError::FileSize(path, n) => write!(
                f,
                "the old key file {} is {n} bytes, not {KEY_BYTES}; it was left unchanged",
                path.display()
            ),
            KeyError::ReadBack => f.write_str(
                "the master key read back from Windows Credential Manager does not match what was written",
            ),
            KeyError::Random => f.write_str("no OS randomness for a new master key"),
        }
    }
}

impl std::error::Error for KeyError {}

/// `<data>\secrets\master.key`.
pub fn key_file(data_dir: &Path) -> PathBuf {
    data_dir.join(SECRETS_DIR).join(KEY_FILE)
}

/// Finds the key as the module docs describe. `data_dir` is the server's data dir.
pub fn resolve(store: &dyn KeyStore, data_dir: &Path) -> Result<(MasterKey, KeyOrigin), KeyError> {
    if let Some(stored) = store.read().map_err(KeyError::Store)? {
        let bytes = stored.as_slice();
        if bytes.len() != KEY_BYTES {
            return Err(KeyError::StoredSize(bytes.len()));
        }
        return Ok((MasterKey::from_bytes(bytes), KeyOrigin::Stored));
    }

    let file = key_file(data_dir);
    let (fresh, origin) = match std::fs::read(&file) {
        Ok(bytes) => {
            let bytes = KeyBytes::new(bytes);
            if bytes.as_slice().len() != KEY_BYTES {
                return Err(KeyError::FileSize(file, bytes.as_slice().len()));
            }
            (bytes, KeyOrigin::Imported)
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            let mut bytes = vec![0u8; KEY_BYTES];
            if getrandom::fill(&mut bytes).is_err() {
                wipe(&mut bytes);
                return Err(KeyError::Random);
            }
            (KeyBytes::new(bytes), KeyOrigin::Generated)
        }
        Err(err) => return Err(KeyError::FileRead(file, err)),
    };

    store.write(fresh.as_slice()).map_err(KeyError::Store)?;
    let back = store.read().map_err(KeyError::Store)?;
    match back {
        Some(back) if back.as_slice() == fresh.as_slice() => {
            Ok((MasterKey::from_bytes(back.as_slice()), origin))
        }
        _ => Err(KeyError::ReadBack),
    }
}

/// A store in memory, for tests.
#[derive(Default)]
pub struct MemoryStore {
    entry: std::sync::Mutex<Option<Vec<u8>>>,
    /// When set, `write` stores these bytes instead (a store that corrupts what it is given).
    pub corrupt_writes: Option<Vec<u8>>,
    /// When set, every call fails with this error kind.
    pub fail: Option<io::ErrorKind>,
}

impl MemoryStore {
    pub fn holding(bytes: &[u8]) -> Self {
        let store = Self::default();
        *store.entry.lock().unwrap() = Some(bytes.to_vec());
        store
    }

    /// A store whose every call fails with `kind`.
    pub fn failing(kind: io::ErrorKind) -> Self {
        Self {
            fail: Some(kind),
            ..Self::default()
        }
    }

    pub fn entry(&self) -> Option<Vec<u8>> {
        self.entry.lock().unwrap().clone()
    }
}

impl KeyStore for MemoryStore {
    fn read(&self) -> io::Result<Option<KeyBytes>> {
        if let Some(kind) = self.fail {
            return Err(io::Error::from(kind));
        }
        Ok(self.entry.lock().unwrap().clone().map(KeyBytes::new))
    }

    fn write(&self, key: &[u8]) -> io::Result<()> {
        if let Some(kind) = self.fail {
            return Err(io::Error::from(kind));
        }
        let stored = self.corrupt_writes.clone().unwrap_or_else(|| key.to_vec());
        *self.entry.lock().unwrap() = Some(stored);
        Ok(())
    }
}

/// The platform's store: Windows Credential Manager, or a store that always fails elsewhere.
pub fn system_store() -> std::sync::Arc<dyn KeyStore> {
    #[cfg(windows)]
    {
        std::sync::Arc::new(credman::CredentialManager::new(CREDENTIAL_TARGET))
    }
    #[cfg(not(windows))]
    {
        std::sync::Arc::new(Unsupported)
    }
}

/// Windows Credential Manager. Not covered by the automated tests (they use [`MemoryStore`], so a
/// test run never touches the developer's real credentials); check it on a Windows desktop.
#[cfg(windows)]
pub mod credman {
    use std::io;

    use windows_sys::Win32::Foundation::ERROR_NOT_FOUND;
    use windows_sys::Win32::Security::Credentials::{
        CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_MAX_CREDENTIAL_BLOB_SIZE,
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    use super::{wipe, KeyBytes, KeyStore};

    /// A generic credential of the signed-in user (Windows protects its blob with DPAPI under the
    /// user's logon). `CRED_PERSIST_LOCAL_MACHINE`: it stays on this PC and does not roam, like
    /// the data dir it belongs to (`%LOCALAPPDATA%`).
    pub struct CredentialManager {
        target: Vec<u16>,
    }

    impl CredentialManager {
        pub fn new(target: &str) -> Self {
            Self {
                target: target.encode_utf16().chain(std::iter::once(0)).collect(),
            }
        }
    }

    impl KeyStore for CredentialManager {
        fn read(&self) -> io::Result<Option<KeyBytes>> {
            let mut found: *mut CREDENTIALW = std::ptr::null_mut();
            // SAFETY: a NUL-terminated UTF-16 target, and an out pointer the call fills.
            let ok = unsafe { CredReadW(self.target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut found) };
            if ok == 0 {
                let err = io::Error::last_os_error();
                if err.raw_os_error() == Some(ERROR_NOT_FOUND as i32) {
                    return Ok(None);
                }
                return Err(err);
            }
            // SAFETY: on success `found` points to a CREDENTIALW the system allocated; its blob is
            // `CredentialBlobSize` bytes (or null when empty). Wiped, then freed once with CredFree.
            unsafe {
                let cred = &*found;
                let size = cred.CredentialBlobSize as usize;
                let bytes = if cred.CredentialBlob.is_null() || size == 0 {
                    Vec::new()
                } else {
                    let blob = std::slice::from_raw_parts_mut(cred.CredentialBlob, size);
                    let copy = blob.to_vec();
                    wipe(blob);
                    copy
                };
                CredFree(found.cast());
                Ok(Some(KeyBytes::new(bytes)))
            }
        }

        fn write(&self, key: &[u8]) -> io::Result<()> {
            if key.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
                return Err(io::Error::from(io::ErrorKind::InvalidInput));
            }
            let mut target = self.target.clone();
            let cred = CREDENTIALW {
                Type: CRED_TYPE_GENERIC,
                TargetName: target.as_mut_ptr(),
                CredentialBlobSize: key.len() as u32,
                // CredWriteW only reads the blob.
                CredentialBlob: key.as_ptr().cast_mut(),
                Persist: CRED_PERSIST_LOCAL_MACHINE,
                ..CREDENTIALW::default()
            };
            // SAFETY: every pointer in `cred` is valid for the duration of the call.
            let ok = unsafe { CredWriteW(&cred, 0) };
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }
    }
}

#[cfg(not(windows))]
struct Unsupported;

#[cfg(not(windows))]
impl KeyStore for Unsupported {
    fn read(&self) -> io::Result<Option<KeyBytes>> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "the master key store needs Windows Credential Manager",
        ))
    }
    fn write(&self, _key: &[u8]) -> io::Result<()> {
        self.read().map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mawl-key-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_key_file(dir: &Path, bytes: &[u8]) -> PathBuf {
        let file = key_file(dir);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, bytes).unwrap();
        file
    }

    fn decode(text: &str) -> Vec<u8> {
        // Test-only base64url decoder, to check the stdin form against the stored bytes.
        const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut bits = 0u32;
        let mut n = 0;
        let mut out = Vec::new();
        for c in text.bytes() {
            bits = (bits << 6) | A.iter().position(|&a| a == c).unwrap() as u32;
            n += 6;
            if n >= 8 {
                n -= 8;
                out.push((bits >> n) as u8);
                bits &= (1 << n) - 1;
            }
        }
        out
    }

    #[test]
    fn first_run_generates_a_key_persists_it_and_later_runs_read_the_same_one() {
        let dir = temp_dir("first");
        let store = MemoryStore::default();
        let (key, origin) = resolve(&store, &dir).unwrap();
        assert_eq!(origin, KeyOrigin::Generated);
        assert_eq!(key.expose().len(), KEY_CHARS);
        assert_eq!(KEY_CHARS, 43);
        assert!(key
            .expose()
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
        let stored = store.entry().unwrap();
        assert_eq!(stored.len(), KEY_BYTES);
        assert_eq!(decode(key.expose()), stored);

        let (again, origin) = resolve(&store, &dir).unwrap();
        assert_eq!(origin, KeyOrigin::Stored);
        assert_eq!(again, key);
        // No key file is created on the desktop path.
        assert!(!key_file(&dir).exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn two_installs_get_different_keys() {
        let dir = temp_dir("two");
        let a = resolve(&MemoryStore::default(), &dir).unwrap().0;
        let b = resolve(&MemoryStore::default(), &dir).unwrap().0;
        assert_ne!(a, b);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_empty_store_imports_the_old_key_file_and_leaves_the_file() {
        let dir = temp_dir("import");
        let old: Vec<u8> = (0..32).collect();
        let file = write_key_file(&dir, &old);
        let store = MemoryStore::default();
        let (key, origin) = resolve(&store, &dir).unwrap();
        assert_eq!(origin, KeyOrigin::Imported);
        assert_eq!(store.entry().unwrap(), old);
        assert_eq!(decode(key.expose()), old);
        // The server deletes it after a verified decrypt, never the host.
        assert_eq!(std::fs::read(&file).unwrap(), old);
        // The next run reads the store.
        assert_eq!(resolve(&store, &dir).unwrap().1, KeyOrigin::Stored);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_stored_key_wins_over_the_old_file() {
        let dir = temp_dir("wins");
        write_key_file(&dir, &[7u8; 32]);
        let store = MemoryStore::holding(&[9u8; 32]);
        let (key, origin) = resolve(&store, &dir).unwrap();
        assert_eq!(origin, KeyOrigin::Stored);
        assert_eq!(decode(key.expose()), vec![9u8; 32]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_wrong_sized_old_file_is_an_error_and_nothing_is_written() {
        let dir = temp_dir("filesize");
        write_key_file(&dir, &[1u8; 31]);
        let store = MemoryStore::default();
        let err = resolve(&store, &dir).unwrap_err();
        assert!(matches!(err, KeyError::FileSize(_, 31)), "{err:?}");
        assert!(store.entry().is_none());
        assert!(err.to_string().contains("31 bytes"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_wrong_sized_stored_key_is_an_error_and_is_never_replaced() {
        let dir = temp_dir("storedsize");
        let store = MemoryStore::holding(&[3u8; 16]);
        let err = resolve(&store, &dir).unwrap_err();
        assert!(matches!(err, KeyError::StoredSize(16)));
        assert_eq!(store.entry().unwrap(), vec![3u8; 16]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_read_back_that_differs_aborts() {
        let dir = temp_dir("readback");
        let store = MemoryStore {
            corrupt_writes: Some(vec![0u8; 32]),
            ..MemoryStore::default()
        };
        let err = resolve(&store, &dir).unwrap_err();
        assert!(matches!(err, KeyError::ReadBack), "{err:?}");
        // The import path checks it too.
        write_key_file(&dir, &[5u8; 32]);
        let store = MemoryStore {
            corrupt_writes: Some(vec![6u8; 32]),
            ..MemoryStore::default()
        };
        assert!(matches!(resolve(&store, &dir), Err(KeyError::ReadBack)));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_failing_store_is_an_error_not_a_new_key() {
        let dir = temp_dir("fail");
        let store = MemoryStore {
            fail: Some(io::ErrorKind::PermissionDenied),
            ..MemoryStore::default()
        };
        assert!(matches!(resolve(&store, &dir), Err(KeyError::Store(_))));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn debug_display_and_errors_never_show_the_key() {
        let dir = temp_dir("redact");
        let (key, _) = resolve(&MemoryStore::default(), &dir).unwrap();
        assert!(!format!("{key:?}").contains(key.expose()));
        assert!(!format!("{key}").contains(key.expose()));
        let bytes = KeyBytes::new(vec![0x41; 32]);
        assert!(!format!("{bytes:?}").contains("AAAA"));
        assert!(!format!("{bytes:?}").contains("65"));
        let line = format!("x {k} y {k}", k = key.expose());
        assert_eq!(key.redact(&line), "x [redacted] y [redacted]");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn wipe_zeroes_every_byte() {
        let mut bytes = vec![0xaa_u8; 40];
        wipe(&mut bytes);
        assert!(bytes.iter().all(|&b| b == 0));
    }
}
