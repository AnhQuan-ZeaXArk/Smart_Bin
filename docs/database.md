# Database

SQLite is used for the prototype through Prisma. The migration is generated from `apps/api/prisma/schema.prisma`.

Relationships:

- Role has many Users.
- Employee has one optional User and many NFC cards, access logs, and collection records.
- Bin has many sensor readings, access logs, collection records, and alerts.
- Employee owns NFC cards and can be linked to one User login without duplicating authentication credentials.
- Access logs keep employee, NFC card, and bin references nullable where hardware context is unknown.
- NFC UIDs are stored in canonical uppercase colon-separated form. Card status and employee status are checked by the NFC authentication service.

Milestone 4 adds `LOST` and `EXPIRED` NFC statuses, access result reasons, the optional `nfcCardId` relation, and indexes for employee/card access history. Existing access logs receive `UNKNOWN_CARD` during migration when no reason was previously available.

Enums provide stable status values for roles, employee/card/bin states, access results, collection workflow, and alert severity.
