package version

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/sucheng1101/infinity-canvas/server/internal/model"
	"gorm.io/gorm"
)

const (
	defaultSourceURL = "https://github.com/sucheng1101/infinity-canvas"
	versionURL       = "https://raw.githubusercontent.com/sucheng1101/infinity-canvas/main/VERSION"
	changelogURL     = "https://raw.githubusercontent.com/sucheng1101/infinity-canvas/main/CHANGELOG.md"
)

type Release struct {
	CurrentVersion string                 `json:"currentVersion"`
	LatestVersion  string                 `json:"latestVersion"`
	Source         string                 `json:"source"`
	SourceURL      string                 `json:"sourceUrl"`
	Changelog      string                 `json:"changelog"`
	CheckedAt      time.Time              `json:"checkedAt"`
	HasUpdate      bool                   `json:"hasUpdate"`
	UpdateJob      *model.SystemUpdateJob `json:"updateJob,omitempty"`
}

type Service struct {
	DB     *gorm.DB
	Client *http.Client
}

func (s *Service) Check(ctx context.Context) (Release, error) {
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	current := readCurrentVersion()
	latest, err := fetchText(ctx, client, versionURL)
	if err != nil {
		return Release{}, err
	}
	changelog, _ := fetchText(ctx, client, changelogURL)
	latest = strings.TrimSpace(latest)
	return Release{CurrentVersion: current, LatestVersion: latest, Source: "github", SourceURL: defaultSourceURL, Changelog: changelog, CheckedAt: time.Now().UTC(), HasUpdate: newer(latest, current)}, nil
}

func (s *Service) LatestJob() (*model.SystemUpdateJob, error) {
	var job model.SystemUpdateJob
	err := s.DB.Order("created_at DESC").First(&job).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &job, err
}

func (s *Service) QueueUpdate(operatorID uint, target string) (Release, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return Release{}, errors.New("target version required")
	}
	job := model.SystemUpdateJob{ID: uuid.NewString(), TargetVersion: target, Source: "github", Status: "queued", RequestedBy: operatorID}
	if err := s.DB.Create(&job).Error; err != nil {
		return Release{}, err
	}
	current := readCurrentVersion()
	return Release{CurrentVersion: current, LatestVersion: target, Source: "github", SourceURL: defaultSourceURL, CheckedAt: time.Now().UTC(), HasUpdate: newer(target, current), UpdateJob: &job}, nil
}

func fetchText(ctx context.Context, client *http.Client, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", errors.New("release source unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	return string(data), err
}

func readCurrentVersion() string {
	for _, path := range []string{"VERSION", filepath.Join("..", "VERSION"), filepath.Join("..", "..", "VERSION")} {
		if data, err := os.ReadFile(path); err == nil && strings.TrimSpace(string(data)) != "" {
			return strings.TrimSpace(string(data))
		}
	}
	if value := strings.TrimSpace(os.Getenv("APP_VERSION")); value != "" {
		return value
	}
	return "dev"
}

func newer(latest, current string) bool {
	parse := func(value string) [3]int {
		var result [3]int
		value = strings.TrimPrefix(strings.TrimSpace(value), "v")
		_, _ = fmt.Sscanf(value, "%d.%d.%d", &result[0], &result[1], &result[2])
		return result
	}
	a, b := parse(latest), parse(current)
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}
