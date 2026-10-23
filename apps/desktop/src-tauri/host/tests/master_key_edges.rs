//! Edge cases of the master key resolution: stores that misbehave, odd key files.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use mawl_host::master_key::{
    key_file, resolve, KeyBytes, KeyError, KeyOrigin, KeyStore, MemoryStore, KEY_BYTES,
};

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mawl-keyedge-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn put_key_file(dir: &Path, bytes: &[u8]) {
    let file = key_file(dir);
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(file, bytes).unwrap();
}

/// A store that scripts each call: reads come from `reads` in order, writes are recorded.
struct Script {
    reads: Mutex<Vec<io::Result<Option<Vec<u8>>>>>,
    write_result: Mutex<Option<io::Error>>,
    written: Mutex<Vec<Vec<u8>>>,
}

impl Script {
    fn new(reads: Vec<io::Result<Option<Vec<u8>>>>, write_err: Option<io::ErrorKind>) -> Self {
        Self {
            reads: Mutex::new(reads),
            write_result: Mutex::new(write_err.map(io::Error::from)),
            written: Mutex::new(Vec::new()),
        }
    }
}

impl KeyStore for Script {
    fn read(&self) -> io::Result<Option<KeyBytes>> {
        let mut reads = self.reads.lock().unwrap();
        assert!(
            !reads.is_empty(),
            "the store was read more often than scripted"
        );
        reads.remove(0).map(|o| o.map(KeyBytes::new))
    }

    fn write(&self, key: &[u8]) -> io::Result<()> {
        self.written.lock().unwrap().push(key.to_vec());
        match self.write_result.lock().unwrap().take() {
            Some(err) => Err(err),
            None => Ok(()),
        }
    }

    fn delete(&self) -> io::Result<()> {
        panic!("the master key is never deleted");
    }
}

#[test]
fn a_write_that_fails_is_a_store_error_and_the_key_is_not_used() {
    let dir = temp_dir("writefail");
    let store = Script::new(vec![Ok(None)], Some(io::ErrorKind::PermissionDenied));
    let err = resolve(&store, &dir).unwrap_err();
    assert!(matches!(err, KeyError::Store(_)), "{err:?}");
    assert_eq!(store.written.lock().unwrap().len(), 1);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_read_back_that_finds_nothing_aborts() {
    let dir = temp_dir("backnone");
    // Accepts the write, then reports no entry (a store that silently drops writes).
    let store = Script::new(vec![Ok(None), Ok(None)], None);
    assert!(matches!(resolve(&store, &dir), Err(KeyError::ReadBack)));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_read_back_that_errors_is_a_store_error() {
    let dir = temp_dir("backerr");
    let store = Script::new(
        vec![Ok(None), Err(io::Error::from(io::ErrorKind::TimedOut))],
        None,
    );
    assert!(matches!(resolve(&store, &dir), Err(KeyError::Store(_))));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_read_back_of_the_wrong_length_aborts() {
    let dir = temp_dir("backshort");
    let store = Script::new(vec![Ok(None), Ok(Some(vec![0u8; 16]))], None);
    assert!(matches!(resolve(&store, &dir), Err(KeyError::ReadBack)));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_read_back_that_differs_in_one_byte_aborts() {
    let dir = temp_dir("backbit");
    put_key_file(&dir, &[0x55u8; 32]);
    let mut other = vec![0x55u8; 32];
    other[31] ^= 1;
    let store = Script::new(vec![Ok(None), Ok(Some(other))], None);
    assert!(matches!(resolve(&store, &dir), Err(KeyError::ReadBack)));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_store_error_on_the_first_read_never_generates_a_key_or_touches_the_file() {
    let dir = temp_dir("firstreaderr");
    put_key_file(&dir, &[1u8; 32]);
    let store = Script::new(
        vec![Err(io::Error::from(io::ErrorKind::PermissionDenied))],
        None,
    );
    assert!(matches!(resolve(&store, &dir), Err(KeyError::Store(_))));
    assert!(store.written.lock().unwrap().is_empty());
    assert_eq!(std::fs::read(key_file(&dir)).unwrap(), vec![1u8; 32]);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_empty_stored_entry_is_a_size_error_not_a_missing_one() {
    let dir = temp_dir("storedempty");
    let store = MemoryStore::holding(&[]);
    assert!(matches!(
        resolve(&store, &dir),
        Err(KeyError::StoredSize(0))
    ));
    assert_eq!(store.entry().unwrap().len(), 0);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_stored_entry_one_byte_too_long_is_never_replaced() {
    let dir = temp_dir("storedlong");
    let store = MemoryStore::holding(&[4u8; 33]);
    assert!(matches!(
        resolve(&store, &dir),
        Err(KeyError::StoredSize(33))
    ));
    assert_eq!(store.entry().unwrap(), vec![4u8; 33]);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn old_key_files_of_the_wrong_length_are_refused_and_nothing_is_stored() {
    for len in [0usize, 1, 31, 33, 64, 4096] {
        let dir = temp_dir(&format!("filelen{len}"));
        put_key_file(&dir, &vec![9u8; len]);
        let store = MemoryStore::default();
        let err = resolve(&store, &dir).unwrap_err();
        assert!(
            matches!(&err, KeyError::FileSize(_, n) if *n == len),
            "{len}: {err:?}"
        );
        assert!(store.entry().is_none(), "{len}");
        assert_eq!(std::fs::read(key_file(&dir)).unwrap().len(), len);
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[test]
fn an_old_key_file_that_cannot_be_read_is_an_error_and_not_a_new_key() {
    let dir = temp_dir("filedir");
    // A directory where the file should be: not NotFound, so no key may be generated.
    std::fs::create_dir_all(key_file(&dir)).unwrap();
    let store = MemoryStore::default();
    let err = resolve(&store, &dir).unwrap_err();
    assert!(matches!(err, KeyError::FileRead(_, _)), "{err:?}");
    assert!(store.entry().is_none());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn an_all_zero_old_key_file_is_imported_as_is() {
    let dir = temp_dir("zeros");
    put_key_file(&dir, &[0u8; 32]);
    let store = MemoryStore::default();
    let (key, origin) = resolve(&store, &dir).unwrap();
    assert_eq!(origin, KeyOrigin::Imported);
    assert_eq!(key.expose(), "A".repeat(43));
    assert_eq!(store.entry().unwrap(), vec![0u8; KEY_BYTES]);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn error_texts_carry_no_key_material() {
    let dir = temp_dir("errtext");
    let secret = vec![0xabu8; 32];
    let stored_text = "q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s"; // base64url of 0xab * 32
    for err in [
        KeyError::ReadBack,
        KeyError::StoredSize(33),
        KeyError::FileSize(key_file(&dir), 31),
        KeyError::Random,
        KeyError::Store(io::Error::from(io::ErrorKind::PermissionDenied)),
    ] {
        let text = format!("{err} / {err:?}");
        assert!(!text.contains(stored_text), "{text}");
        assert!(!text.contains("171"), "{text}");
    }
    // A mismatched read-back reports no bytes of either side.
    let store = Script::new(vec![Ok(None), Ok(Some(secret.clone()))], None);
    put_key_file(&dir, &[0x11u8; 32]);
    let err = resolve(&store, &dir).unwrap_err();
    let text = format!("{err} / {err:?}");
    assert!(!text.contains("q6ur") && !text.contains("EREREREREREREREREREREREREREREREREREREREREQ"));
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn resolving_twice_from_a_fresh_store_is_stable_after_import() {
    let dir = temp_dir("stable");
    let old: Vec<u8> = (100..132).collect();
    put_key_file(&dir, &old);
    let store = MemoryStore::default();
    let (a, _) = resolve(&store, &dir).unwrap();
    // The file vanishing after the import (the server deleted it) changes nothing.
    std::fs::remove_file(key_file(&dir)).unwrap();
    let (b, origin) = resolve(&store, &dir).unwrap();
    assert_eq!(origin, KeyOrigin::Stored);
    assert_eq!(a, b);
    let _ = std::fs::remove_dir_all(dir);
}
