package relay

import (
	"net/http"
	"testing"
)

func TestRetryableUpstreamStatus(t *testing.T) {
	cases := []struct {
		status int
		want   bool
	}{
		{http.StatusOK, false},
		{http.StatusBadRequest, false},
		{http.StatusUnauthorized, false},
		{http.StatusTooManyRequests, true},
		{http.StatusInternalServerError, true},
		{http.StatusBadGateway, true},
		{http.StatusServiceUnavailable, true},
	}
	for _, testCase := range cases {
		if got := retryableUpstreamStatus(testCase.status); got != testCase.want {
			t.Fatalf("retryableUpstreamStatus(%d) = %v, want %v", testCase.status, got, testCase.want)
		}
	}
}
