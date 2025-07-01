// Recording data model
export class Recording {
  constructor({
    id,
    title,
    filePath,
    date,
    duration,
    transcript = null,
    summary = null,
    processingStatus = 'pending', // pending, processing, complete, error
    userModifiedTitle = false
  }) {
    this.id = id;
    this.title = title;
    this.filePath = filePath;
    this.date = date;
    this.duration = duration;
    this.transcript = transcript;
    this.summary = summary;
    this.processingStatus = processingStatus;
    this.userModifiedTitle = userModifiedTitle;
  }

  // Convert to plain object for storage
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      filePath: this.filePath,
      date: this.date,
      duration: this.duration,
      transcript: this.transcript,
      summary: this.summary,
      processingStatus: this.processingStatus,
      userModifiedTitle: this.userModifiedTitle
    };
  }

  // Create from plain object
  static fromJSON(json) {
    return new Recording(json);
  }
}

// Transcription data model
export class Transcription {
  constructor({
    recordingId,
    text,
    createdAt
  }) {
    this.recordingId = recordingId;
    this.text = text;
    this.createdAt = createdAt;
  }

  toJSON() {
    return {
      recordingId: this.recordingId,
      text: this.text,
      createdAt: this.createdAt
    };
  }

  static fromJSON(json) {
    return new Transcription(json);
  }
}

// Summary data model
export class Summary {
  constructor({
    recordingId,
    text,
    createdAt
  }) {
    this.recordingId = recordingId;
    this.text = text;
    this.createdAt = createdAt;
  }

  toJSON() {
    return {
      recordingId: this.recordingId,
      text: this.text,
      createdAt: this.createdAt
    };
  }

  static fromJSON(json) {
    return new Summary(json);
  }
}
