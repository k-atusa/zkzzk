package db_test

import (
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/k-atusa/zkzzk/backend/db"
)

func TestFlexTypes(t *testing.T) {
	var ft db.FlexTime
	for _, sample := range []any{
		"2026-07-04T02:34:47.796+00:00",
		"2026-07-04 02:34:47",
		int64(1783132487796),
	} {
		if err := ft.Scan(sample); err != nil || !ft.Valid {
			t.Fatalf("FlexTime failed to scan %v: %v", sample, err)
		}
	}

	var fb db.FlexBool
	for _, sample := range []any{true, int64(1), "true", "1"} {
		if err := fb.Scan(sample); err != nil || !fb.Valid || !fb.Bool {
			t.Fatalf("FlexBool failed to scan truthy %v: %v", sample, err)
		}
	}
	for _, sample := range []any{false, int64(0), "false", "0"} {
		if err := fb.Scan(sample); err != nil || !fb.Valid || fb.Bool {
			t.Fatalf("FlexBool failed to scan falsy %v: %v", sample, err)
		}
	}
}

func TestLegacyDatabaseCompatibility(t *testing.T) {
	srcPath := filepath.Join("..", "database.db")
	if _, err := os.Stat(srcPath); err != nil {
		t.Skip("no local backend/database.db present")
	}

	copyPath := filepath.Join(t.TempDir(), "copy.db")
	in, err := os.Open(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	out, err := os.Create(copyPath)
	if err != nil {
		_ = in.Close()
		t.Fatal(err)
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = in.Close()
		_ = out.Close()
		t.Fatal(err)
	}
	_ = in.Close()
	_ = out.Close()

	store, err := db.Open(copyPath)
	if err != nil {
		t.Fatalf("db.Open on copy failed: %v", err)
	}
	defer store.Close()

	if _, err := store.IsInitialized(); err != nil {
		t.Fatalf("IsInitialized failed: %v", err)
	}
	if _, err := store.ListUsers(); err != nil {
		t.Fatalf("ListUsers failed: %v", err)
	}
	if _, err := store.ListStreamers("", true); err != nil {
		t.Fatalf("ListStreamers failed: %v", err)
	}
	if _, err := store.ListRecordings("", true); err != nil {
		t.Fatalf("ListRecordings failed: %v", err)
	}
}
