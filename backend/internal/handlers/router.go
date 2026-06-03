package handlers

import (
	"net/http"

	"github.com/gitvisual/backend/internal/db"
)

func NewRouter(database *db.DB) http.Handler {
	h := newHandler(database)
	mux := http.NewServeMux()

	mux.HandleFunc("/api/events", h.sse)
	mux.HandleFunc("/api/repos", h.repos)
	mux.HandleFunc("/api/repos/", h.reposSub)
	mux.HandleFunc("/api/ssh-keys", h.sshKeys)
	mux.HandleFunc("/api/schema", h.schema)
	mux.HandleFunc("/api/table-data", h.tableData)
	mux.HandleFunc("/api/export-csv", h.exportCSV)
	mux.HandleFunc("/api/import-csv", h.importCSV)
	mux.HandleFunc("/api/audit", h.audit)
	mux.HandleFunc("/api/search", h.search)
	mux.HandleFunc("/api/config", h.globalConfig)
	mux.HandleFunc("/api/ssh-test", h.sshTest)
	mux.HandleFunc("/api/ssh-config", h.sshConfig)

	return cors(mux)
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS,PATCH")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Requested-With")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}


