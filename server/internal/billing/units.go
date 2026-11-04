// Package billing holds the unit rules shared by usage logging, subscription
// deductions and channel settlement, so the three paths cannot drift apart.
package billing

import "strings"

// Units converts the amounts a capability bills for into billable units.
// Callers decide the fallbacks, because usage logs and quote pre-deduction count
// missing values differently.
func Units(capability string, imageCount, videoSeconds, textTokens float64) float64 {
	switch strings.ToLower(strings.TrimSpace(capability)) {
	case "image":
		return imageCount
	case "video":
		return videoSeconds
	case "text":
		return textTokens
	}
	return 0
}

// UnitForCapability names the subscription quota a capability consumes.
func UnitForCapability(capability string) string {
	switch strings.ToLower(strings.TrimSpace(capability)) {
	case "image":
		return "image"
	case "video":
		return "second"
	case "text":
		return "token"
	default:
		return "request"
	}
}
