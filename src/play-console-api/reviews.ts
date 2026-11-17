// Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/reviews
import type { androidpublisher_v3 } from '@googleapis/androidpublisher';
import type { PlayReplyResult, PlayReview } from '@/core/types/googlePlay.js';
import type { MutableDeep } from '@/core/types/mutable.js';
import { collectGeneratedPages, isGooglePlayApiError, type PlayRequests } from './api-client.js';

const timestampToIso = (
  timestamp: androidpublisher_v3.Schema$Timestamp | undefined,
): string | undefined => {
  if (typeof timestamp?.seconds !== 'string') return;
  return new Date(Number(timestamp.seconds) * 1000).toISOString();
};

const readReview = (googleReview: androidpublisher_v3.Schema$Review): PlayReview | undefined => {
  if (typeof googleReview.reviewId !== 'string') return;
  const userComment = googleReview.comments?.find((comment) => comment.userComment)?.userComment;
  const developerComment = googleReview.comments?.find(
    (comment) => comment.developerComment,
  )?.developerComment;
  let rating = 0;
  if (typeof userComment?.starRating === 'number') rating = userComment.starRating;
  const review: MutableDeep<PlayReview> = {
    reviewId: googleReview.reviewId,
    rating,
    answered: developerComment !== undefined,
  };
  if (typeof googleReview.authorName === 'string') review.authorName = googleReview.authorName;
  if (typeof userComment?.text === 'string') review.text = userComment.text;
  if (typeof userComment?.reviewerLanguage === 'string') {
    review.reviewerLanguage = userComment.reviewerLanguage;
  }
  if (typeof userComment?.device === 'string') review.device = userComment.device;
  if (typeof userComment?.appVersionName === 'string') {
    review.appVersionName = userComment.appVersionName;
  }
  const lastModified = timestampToIso(userComment?.lastModified);
  if (lastModified !== undefined) review.lastModified = lastModified;
  if (typeof developerComment?.text === 'string') review.developerReply = developerComment.text;
  return review;
};

export const makeReviewsApi = (play: PlayRequests) => {
  /**
   * List the app's customer reviews, paging in full. Only reviews with text from the last ~week are
   * returned - a Play platform limit, not Launch's.
   */
  const listReviews = (
    packageName: string,
    options: Readonly<{ translationLanguage?: string }> = {},
  ): Promise<PlayReview[]> =>
    collectGeneratedPages(
      (pageToken) => {
        const listParameters: androidpublisher_v3.Params$Resource$Reviews$List = { packageName };
        if (options.translationLanguage !== undefined) {
          listParameters.translationLanguage = options.translationLanguage;
        }
        if (pageToken !== undefined) listParameters.token = pageToken;
        return play.send('list reviews', () => play.publisher.reviews.list(listParameters));
      },
      (reviewPage) => {
        const reviews: PlayReview[] = [];
        if (!Array.isArray(reviewPage.reviews)) return reviews;
        for (const googleReview of reviewPage.reviews) {
          const review = readReview(googleReview);
          if (review !== undefined) reviews.push(review);
        }
        return reviews;
      },
      (reviewPage) => reviewPage.tokenPagination?.nextPageToken,
    );

  /** Fetch one review by id, or null when it doesn't exist / is too old. */
  const getReview = async (packageName: string, reviewId: string): Promise<PlayReview | null> => {
    try {
      const googleReview = await play.send('get review', () =>
        play.publisher.reviews.get({ packageName, reviewId }),
      );
      const review = readReview(googleReview);
      if (review === undefined) return null;
      return review;
    } catch (failure) {
      if (isGooglePlayApiError(failure)) {
        if (failure.statusCode === 404) return null;
      }
      throw failure;
    }
  };

  /** Post (or replace) the public developer reply to a review; Play only accepts reviews from the last ~week. */
  const replyToReview = async (
    packageName: string,
    reviewId: string,
    replyText: string,
  ): Promise<PlayReplyResult> => {
    const replyConfirmation = await play.send('reply to review', () =>
      play.publisher.reviews.reply({ packageName, reviewId, requestBody: { replyText } }),
    );
    let storedReplyText = replyText;
    if (typeof replyConfirmation.result?.replyText === 'string') {
      storedReplyText = replyConfirmation.result.replyText;
    }
    const reply: MutableDeep<PlayReplyResult> = { replyText: storedReplyText };
    const lastEdited = timestampToIso(replyConfirmation.result?.lastEdited);
    if (lastEdited !== undefined) reply.lastEdited = lastEdited;
    return reply;
  };

  return { listReviews, getReview, replyToReview };
};
