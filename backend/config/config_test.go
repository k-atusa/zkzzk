package config

import (
	"path/filepath"
	"testing"
)

func TestResolveDatabasePathFixed(t *testing.T) {
	if got := resolveDatabasePath("/app"); got != filepath.Join("/app", "backend", "database.db") {
		t.Fatalf("expected /app/backend/database.db, got %s", got)
	}
	if got := resolveDatabasePath("/app/backend"); got != filepath.Join("/app/backend", "database.db") {
		t.Fatalf("expected /app/backend/database.db when cwd is backend, got %s", got)
	}
}
