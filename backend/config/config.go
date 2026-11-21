package config

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// AppVersion matches the application release version exposed to the frontend and metadata.
var AppVersion = "3.1.2"

// Config holds runtime configuration for the ZKZZK server.
type Config struct {
	Port         string
	DatabasePath string
	DownloadsDir string
	JWTSecret    string
	FrontendURL  string
}

// Load reads environment variables and optional .env files to construct Config.
func Load() (*Config, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return nil, err
	}

	rootEnv := loadDotEnv(filepath.Join(cwd, ".env"))
	backendEnv := loadDotEnv(filepath.Join(cwd, "backend", ".env"))

	applyEnvDefaults(rootEnv)
	applyEnvDefaults(backendEnv)

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "5001"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "fallback_secret_for_zkzzk"
	}

	dbPath := resolveDatabasePath(cwd)
	downloadsDir := resolveDownloadsDir(cwd)

	return &Config{
		Port:         port,
		DatabasePath: dbPath,
		DownloadsDir: downloadsDir,
		JWTSecret:    jwtSecret,
		FrontendURL:  strings.TrimRight(strings.TrimSpace(os.Getenv("FRONTEND_URL")), "/"),
	}, nil
}

func resolveDatabasePath(cwd string) string {
	if filepath.Base(cwd) == "backend" {
		return filepath.Join(cwd, "database.db")
	}
	return filepath.Join(cwd, "backend", "database.db")
}

func resolveDownloadsDir(cwd string) string {
	if raw := strings.TrimSpace(os.Getenv("DOWNLOADS_DIR")); raw != "" {
		abs, err := filepath.Abs(raw)
		if err == nil {
			return abs
		}
		return filepath.Clean(raw)
	}

	for _, candidate := range []string{
		filepath.Join(cwd, "downloads"),
		filepath.Join(cwd, "..", "downloads"),
	} {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			abs, err := filepath.Abs(candidate)
			if err == nil {
				return abs
			}
			return candidate
		}
	}

	return filepath.Join(cwd, "downloads")
}

func loadDotEnv(path string) map[string]string {
	values := make(map[string]string)
	f, err := os.Open(path)
	if err != nil {
		return values
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		idx := strings.IndexByte(line, '=')
		if idx <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])
		if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
			val = val[1 : len(val)-1]
		}
		values[key] = val
	}
	return values
}

func applyEnvDefaults(values map[string]string) {
	for k, v := range values {
		if _, exists := os.LookupEnv(k); !exists {
			_ = os.Setenv(k, v)
		}
	}
}

// FindExecutable resolves common macOS Homebrew / standard binary paths before falling back to PATH.
func FindExecutable(name string) string {
	candidates := []string{
		filepath.Join("/opt/homebrew/bin", name),
		filepath.Join("/usr/local/bin", name),
	}
	for _, c := range candidates {
		if info, err := os.Stat(c); err == nil && !info.IsDir() {
			return c
		}
	}
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	return name
}
