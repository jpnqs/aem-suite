/**
 * In-app help for the Help app: the user guide (docs/user-guide.md) as rendered sections.
 * Open to every logged-in user - the help is not tied to a role.
 */
@path    : '/odata/v4/help'
@requires: 'authenticated-user'
service HelpService {

  /** A "## " section of the user guide. Served from the Markdown file, nothing is stored in the database. */
  @readonly
  @cds.persistence.skip
  entity Sections {
    /** anchor of the heading, e.g. 4-organize-test-cases-in-folders */
    key id       : String(200);
        number   : Integer;
        title    : String(200);
        /** rendered, safe HTML */
        html     : LargeString;
        /** plain text for searching */
        text     : LargeString;
        /** sub headings as JSON: [{ id, title, level }] */
        headings : LargeString;
  }
}
