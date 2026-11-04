package store

import (
	"time"

	"gorm.io/gorm"
)

// PurgeOldRows deletes at most batch rows older than cutoff. The table and column
// come from internal constants only, never from user input, and the batch keeps a
// retention sweep from locking a large table in one statement.
func PurgeOldRows(db *gorm.DB, table, timestampColumn string, cutoff time.Time, batch int) (int64, error) {
	result := db.Exec("DELETE FROM "+table+" WHERE "+timestampColumn+" < ? LIMIT ?", cutoff, batch)
	return result.RowsAffected, result.Error
}
